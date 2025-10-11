const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { Pool } = require('pg');
require('dotenv').config();
const { sendLowStockEmail } = require('./services/emailService');

// --- CONFIGURAÇÃO INICIAL ---
const app = express();
const PORT = process.env.PORT || 10000;

// Middlewares
app.use(cors());
app.use(express.json());

// --- BANCO DE DADOS (PostgreSQL) ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
});

pool
  .connect()
  .then(() => {
    console.log('PostgreSQL database connected successfully.');
    setupDatabase();
  })
  .catch((err) =>
    console.error('Error connecting to the database:', err.message),
  );

// Função para criar as tabelas se não existirem
async function setupDatabase() {
  console.log('Iniciando a configuração do banco de dados...');

  const createTablesScript = `
    CREATE TABLE IF NOT EXISTS produtos (
      id UUID PRIMARY KEY,
      sku TEXT UNIQUE NOT NULL,
      nome TEXT NOT NULL,
      descricao TEXT,
      categoria TEXT,
      unidade TEXT NOT NULL,
      quantidade INTEGER NOT NULL DEFAULT 0,
      estoqueminimo INTEGER,
      localarmazenamento TEXT,
      fornecedor TEXT,
      criadoem TIMESTAMPTZ NOT NULL,
      atualizadoem TIMESTAMPTZ,
      prioritario BOOLEAN DEFAULT FALSE,
      valorunitario NUMERIC(10, 2)
    );

    CREATE TABLE IF NOT EXISTS movimentacoes (
      id UUID PRIMARY KEY,
      produtoid UUID NOT NULL,
      tipo TEXT NOT NULL,
      quantidade INTEGER NOT NULL,
      motivo TEXT,
      criadoem TIMESTAMPTZ NOT NULL,
      FOREIGN KEY (produtoid) REFERENCES produtos (id) ON DELETE CASCADE
    );
  `;
  
  // Scripts para adicionar colunas se elas não existirem
  const alterTableScripts = `
    DO $$
    BEGIN
        IF NOT EXISTS(SELECT * FROM information_schema.columns WHERE table_name='produtos' AND column_name='prioritario') THEN
            ALTER TABLE produtos ADD COLUMN prioritario BOOLEAN DEFAULT FALSE;
        END IF;
        IF NOT EXISTS(SELECT * FROM information_schema.columns WHERE table_name='produtos' AND column_name='valorunitario') THEN
            ALTER TABLE produtos ADD COLUMN valorunitario NUMERIC(10, 2);
        END IF;
    END $$;
  `;

  try {
    await pool.query(createTablesScript);
    console.log('SUCESSO: Tabelas do banco de dados verificadas/criadas com sucesso.');
    await pool.query(alterTableScripts);
    console.log('SUCESSO: Colunas "prioritario" e "valorunitario" verificadas/adicionadas com sucesso.');
  } catch (err) {
    console.error('ERRO CRÍTICO AO CONFIGURAR O BANCO DE DADOS:', err);
  }
}

// --- FUNÇÕES AUXILIARES ---
function uid() {
  return crypto.randomUUID();
}
function gerarSKU() {
  return `PROD-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
}
function nowISO() {
  return new Date().toISOString();
}

function toCamelCase(obj) {
  if (!obj) return obj;
  const newObj = {};
  for (const key in obj) {
    const camelKey = key.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
    if (camelKey === 'estoqueminimo') newObj['estoqueMinimo'] = obj[key];
    else if (camelKey === 'localarmazenamento') newObj['localArmazenamento'] = obj[key];
    else if (camelKey === 'criadoem') newObj['criadoEm'] = obj[key];
    else if (camelKey === 'atualizadoem') newObj['atualizadoEm'] = obj[key];
    else if (camelKey === 'produtoid') newObj['produtoId'] = obj[key];
    else if (camelKey === 'valorunitario') newObj['valorUnitario'] = obj[key];
    else newObj[camelKey] = obj[key];
  }
  return newObj;
}

// --- ROTAS DA API ---

// ROTA DE AUTENTICAÇÃO
app.post('/api/auth/verify-password', async (req, res) => {
  const { password } = req.body;
  if (password && password === process.env.ADMIN_PASSWORD) {
    res.status(200).json({ success: true });
  } else {
    res.status(401).json({ success: false, error: 'Senha incorreta.' });
  }
});


// ROTAS DE PRODUTOS
app.get('/api/produtos', async (req, res) => {
  const page = parseInt(req.query._page, 10) || 1;
  const limit = parseInt(req.query._limit, 10) || 10000;
  const offset = (page - 1) * limit;
  const searchTerm = req.query.q || '';

  try {
    let sql;
    const params = [];

    if (searchTerm) {
      sql = `
        SELECT * FROM produtos
        WHERE
          nome ILIKE $1 OR
          sku ILIKE $1 OR
          categoria ILIKE $1
        ORDER BY nome ASC
        LIMIT $2 OFFSET $3
      `;
      params.push(`%${searchTerm}%`, limit, offset);
    } else {
      sql = 'SELECT * FROM produtos ORDER BY nome ASC LIMIT $1 OFFSET $2';
      params.push(limit, offset);
    }

    const { rows } = await pool.query(sql, params);
    res.json(rows.map(toCamelCase));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/produtos', async (req, res) => {
  const {
    nome,
    descricao,
    categoria,
    unidade,
    quantidade,
    estoqueMinimo,
    localArmazenamento,
    fornecedor,
    valorUnitario,
  } = req.body;

  if (!nome || !unidade) {
    return res.status(400).json({ error: 'Nome e Unidade são obrigatórios.' });
  }

  const novoProduto = {
    id: uid(),
    sku: gerarSKU(),
    nome,
    descricao: descricao || null,
    categoria: categoria || null,
    unidade,
    quantidade: Number(quantidade) || 0,
    estoqueminimo: estoqueMinimo !== undefined ? Number(estoqueMinimo) : null,
    localarmazenamento: localArmazenamento || null,
    fornecedor: fornecedor || null,
    criadoem: nowISO(),
    atualizadoem: null,
    prioritario: false,
    valorunitario: valorUnitario !== undefined ? Number(valorUnitario) : null,
  };

  const sql = `
    INSERT INTO produtos (id, sku, nome, descricao, categoria, unidade, quantidade, estoqueminimo, localarmazenamento, fornecedor, criadoem, atualizadoem, prioritario, valorunitario)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`;
  
  const params = Object.values(novoProduto);

  try {
    const { rows } = await pool.query(sql, params);
    res.status(201).json(toCamelCase(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/produtos/:id', async (req, res) => {
  const { id } = req.params;
  const patch = req.body;
  const allowedFields = [
    'nome',
    'descricao',
    'categoria',
    'unidade',
    'estoqueMinimo',
    'localArmazenamento',
    'fornecedor',
    'prioritario',
    'valorUnitario',
  ];
  const fieldsToUpdate = Object.keys(patch).filter((key) =>
    allowedFields.includes(key),
  );
  if (fieldsToUpdate.length === 0) {
    return res
      .status(400)
      .json({ error: 'Nenhum campo válido para atualização foi fornecido.' });
  }
  
  const dbFieldsToUpdate = fieldsToUpdate.map(field => {
      if (field === 'estoqueMinimo') return 'estoqueminimo';
      if (field === 'localArmazenamento') return 'localarmazenamento';
      if (field === 'valorUnitario') return 'valorunitario';
      return field;
  });

  const setClause = dbFieldsToUpdate
    .map((field, index) => `${field} = $${index + 1}`)
    .join(', ');

  const values = fieldsToUpdate.map((key) => patch[key]);
  
  const sql = `UPDATE produtos SET ${setClause}, atualizadoem = $${
    values.length + 1
  } WHERE id = $${values.length + 2} RETURNING *`;
  
  const params = [...values, nowISO(), id];

  try {
    const result = await pool.query(sql, params);
    if (result.rowCount === 0)
      return res.status(404).json({ error: 'Produto não encontrado.' });
    res.status(200).json(toCamelCase(result.rows[0]));
  } catch (err) {
    console.error('Erro ao atualizar produto:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/produtos/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM produtos WHERE id = $1', [id]);
    if (result.rowCount === 0)
      return res.status(404).json({ error: 'Product not found.' });
    res
      .status(200)
      .json({ message: 'Product and its movements have been deleted.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/produtos/valor-total', async (req, res) => {
  const { password } = req.body;

  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Não autorizado.' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT SUM(quantidade * valorunitario) as valorTotal FROM produtos WHERE valorunitario IS NOT NULL AND valorunitario > 0'
    );
    const valorTotal = rows[0].valortotal || 0;
    res.json({ valorTotal: parseFloat(valorTotal) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ROTAS DE MOVIMENTAÇÕES
app.get('/api/movimentacoes', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM movimentacoes ORDER BY criadoem DESC',
    );
    res.json(rows.map(toCamelCase));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/movimentacoes', async (req, res) => {
  const { produtoId, tipo, quantidade, motivo } = req.body;
  if (!produtoId || !tipo || !quantidade || Number(quantidade) <= 0) {
    return res.status(400).json({ error: 'Invalid movement data.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const productResult = await client.query(
      'SELECT * FROM produtos WHERE id = $1 FOR UPDATE',
      [produtoId],
    );
    const produto = productResult.rows[0];
    if (!produto) throw new Error('Product not found for movement.');

    const estoqueAnterior = produto.quantidade;
    let novaQuantidade;

    if (tipo === 'ajuste') {
      novaQuantidade = Number(quantidade);
    } else {
      const delta =
        tipo === 'entrada' ? Number(quantidade) : -Number(quantidade);
      novaQuantidade = produto.quantidade + delta;
    }
    novaQuantidade = Math.max(0, novaQuantidade);

    if (
      produto.estoqueminimo !== null &&
      novaQuantidade <= produto.estoqueminimo &&
      novaQuantidade !== estoqueAnterior
    ) {
      const produtoParaEmail = { ...produto, quantidade: novaQuantidade };
      sendLowStockEmail(toCamelCase(produtoParaEmail));
    }

    await client.query(
      'UPDATE produtos SET quantidade = $1, atualizadoem = $2 WHERE id = $3',
      [novaQuantidade, nowISO(), produtoId],
    );
    const novaMov = {
      id: uid(),
      produtoid: produtoId,
      tipo,
      quantidade: Number(quantidade),
      motivo: motivo || null,
      criadoem: nowISO(),
    };
    await client.query(
      'INSERT INTO movimentacoes (id, produtoid, tipo, quantidade, motivo, criadoem) VALUES ($1, $2, $3, $4, $5, $6)',
      Object.values(novaMov),
    );
    const updatedProductResult = await client.query(
      'SELECT * FROM produtos WHERE id = $1',
      [produtoId],
    );
    await client.query('COMMIT');
    res.status(201).json({
      movimentacao: toCamelCase(novaMov),
      produto: toCamelCase(updatedProductResult.rows[0]),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: `Transaction failed: ${err.message}` });
  } finally {
    client.release();
  }
});

app.patch('/api/movimentacoes/:id', async (req, res) => {
  const { id } = req.params;
  const { quantidade, motivo } = req.body;

  if (!quantidade || Number(quantidade) <= 0) {
    return res
      .status(400)
      .json({ error: 'A quantidade é obrigatória e deve ser maior que zero.' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const movResult = await client.query(
      'SELECT * FROM movimentacoes WHERE id = $1 FOR UPDATE',
      [id],
    );
    if (movResult.rowCount === 0)
      throw new Error('Movimentação não encontrada.');
    const movimentacaoAntiga = movResult.rows[0];

    if (movimentacaoAntiga.tipo === 'ajuste') {
      throw new Error('Não é permitido editar movimentações do tipo "ajuste".');
    }

    const produtoResult = await client.query(
      'SELECT * FROM produtos WHERE id = $1 FOR UPDATE',
      [movimentacaoAntiga.produtoid],
    );
    if (produtoResult.rowCount === 0)
      throw new Error('Produto associado não encontrado.');
    const produto = produtoResult.rows[0];
    const estoqueAnterior = produto.quantidade;

    const diferenca = quantidade - movimentacaoAntiga.quantidade;

    let novaQuantidadeEstoque;
    if (movimentacaoAntiga.tipo === 'entrada') {
      novaQuantidadeEstoque = produto.quantidade + diferenca;
    } else {
      novaQuantidadeEstoque = produto.quantidade - diferenca;
    }
    novaQuantidadeEstoque = Math.max(0, novaQuantidadeEstoque);

    const updateProdResult = await client.query(
      'UPDATE produtos SET quantidade = $1, atualizadoem = $2 WHERE id = $3 RETURNING *',
      [novaQuantidadeEstoque, nowISO(), produto.id],
    );
    const produtoAtualizado = updateProdResult.rows[0];

    const updateMovResult = await client.query(
      'UPDATE movimentacoes SET quantidade = $1, motivo = $2 WHERE id = $3 RETURNING *',
      [quantidade, motivo, id],
    );
    const movimentacaoAtualizada = updateMovResult.rows[0];

    if (
      produto.estoqueminimo !== null &&
      novaQuantidadeEstoque <= produto.estoqueminimo &&
      novaQuantidadeEstoque !== estoqueAnterior
    ) {
      sendLowStockEmail(toCamelCase(produtoAtualizado));
    }

    await client.query('COMMIT');
    res.status(200).json({
      movimentacaoAtualizada: toCamelCase(movimentacaoAtualizada),
      produtoAtualizado: toCamelCase(produtoAtualizado),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: `Falha na transação: ${err.message}` });
  } finally {
    client.release();
  }
});

app.delete('/api/movimentacoes/:id', async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const movResult = await client.query(
      'SELECT * FROM movimentacoes WHERE id = $1',
      [id],
    );
    if (movResult.rowCount === 0) {
      throw new Error('Movimentação não encontrada.');
    }
    const movimentacao = movResult.rows[0];
    const productResult = await client.query(
      'SELECT * FROM produtos WHERE id = $1 FOR UPDATE',
      [movimentacao.produtoid],
    );
    if (productResult.rowCount === 0) {
      throw new Error('Produto associado não encontrado.');
    }
    const produto = productResult.rows[0];
    const estoqueAnterior = produto.quantidade;
    let novaQuantidade;

    if (movimentacao.tipo === 'saida') {
      novaQuantidade = produto.quantidade + movimentacao.quantidade;
    } else if (movimentacao.tipo === 'entrada') {
      novaQuantidade = produto.quantidade - movimentacao.quantidade;
    } else {
      throw new Error(
        'Não é possível excluir uma movimentação do tipo "ajuste".',
      );
    }
    novaQuantidade = Math.max(0, novaQuantidade);

    const updateResult = await client.query(
      'UPDATE produtos SET quantidade = $1, atualizadoem = $2 WHERE id = $3 RETURNING *',
      [novaQuantidade, nowISO(), movimentacao.produtoid],
    );
    const produtoAtualizado = updateResult.rows[0];

    if (
      produto.estoqueminimo !== null &&
      novaQuantidade <= produto.estoqueminimo &&
      novaQuantidade !== estoqueAnterior
    ) {
      sendLowStockEmail(toCamelCase(produtoAtualizado));
    }

    await client.query('DELETE FROM movimentacoes WHERE id = $1', [id]);
    await client.query('COMMIT');
    res.status(200).json({ produtoAtualizado: toCamelCase(produtoAtualizado) });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.message.includes('ajuste')) {
      res.status(400).json({ error: err.message });
    } else {
      res.status(500).json({ error: `Falha na transação: ${err.message}` });
    }
  } finally {
    client.release();
  }
});

// --- INICIAR O SERVIDOR ---
app.listen(PORT, () => {
  console.log(`🚀 Backend server running at http://localhost:${PORT}`);
});