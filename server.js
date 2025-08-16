const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { Pool } = require('pg');

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

  // VERSÃO 100% CORRIGIDA DO SCRIPT SQL
  const createTablesScript = `
    CREATE TABLE IF NOT EXISTS produtos (
      id UUID PRIMARY KEY,
      sku TEXT UNIQUE NOT NULL,
      nome TEXT NOT NULL,
      descricao TEXT,
      categoria TEXT,
      unidade TEXT NOT NULL,
      quantidade INTEGER NOT NULL DEFAULT 0,
      estoqueMinimo INTEGER,
      localArmazenamento TEXT,
      fornecedor TEXT,
      "criadoEm" TIMESTAMPTZ NOT NULL,
      "atualizadoEm" TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS movimentacoes (
      id UUID PRIMARY KEY,
      "produtoId" UUID NOT NULL,
      tipo TEXT NOT NULL,
      quantidade INTEGER NOT NULL,
      motivo TEXT,
      "criadoEm" TIMESTAMPTZ NOT NULL,   -- <<-- A VÍRGULA FOI REMOVIDA DAQUI
      FOREIGN KEY ("produtoId") REFERENCES produtos (id) ON DELETE CASCADE
    );
  `;

  try {
    await pool.query(createTablesScript);
    console.log(
      'SUCESSO: Tabelas do banco de dados verificadas/criadas com sucesso.',
    );
  } catch (err) {
    console.error('ERRO CRÍTICO AO CRIAR TABELAS:', err);
  }
}

// --- FUNÇÕES AUXILIARES ---
function uid() {
  return crypto.randomUUID();
}

function gerarSKU() {
  const skuPart = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `PROD-${skuPart}`;
}

function nowISO() {
  return new Date().toISOString();
}

// --- ROTAS DA API ---

// GET: Listar todos os produtos
app.get('/api/produtos', async (req, res) => {
  try {
    const sql = 'SELECT * FROM produtos ORDER BY nome ASC';
    const { rows } = await pool.query(sql);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET: Listar todas as movimentações
app.get('/api/movimentacoes', async (req, res) => {
  try {
    const sql = 'SELECT * FROM movimentacoes ORDER BY "criadoEm" DESC';
    const { rows } = await pool.query(sql);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST: Criar novo produto
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
  } = req.body;

  if (!nome || !unidade) {
    return res.status(400).json({ error: 'Name and Unit are mandatory.' });
  }

  const novoProduto = {
    id: uid(),
    sku: gerarSKU(),
    nome,
    descricao: descricao || null,
    categoria: categoria || null,
    unidade,
    quantidade: Number(quantidade) || 0,
    estoqueMinimo: Number(estoqueMinimo) || null,
    localArmazenamento: localArmazenamento || null,
    fornecedor: fornecedor || null,
    criadoEm: nowISO(),
    atualizadoEm: null,
  };

  const sql = `
    INSERT INTO produtos (id, sku, nome, descricao, categoria, unidade, quantidade, estoqueMinimo, localArmazenamento, fornecedor, "criadoEm", "atualizadoEm") 
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  `;

  const params = [
    novoProduto.id,
    novoProduto.sku,
    novoProduto.nome,
    novoProduto.descricao,
    novoProduto.categoria,
    novoProduto.unidade,
    novoProduto.quantidade,
    novoProduto.estoqueMinimo,
    novoProduto.localArmazenamento,
    novoProduto.fornecedor,
    novoProduto.criadoEm,
    novoProduto.atualizadoEm,
  ];

  try {
    await pool.query(sql, params);
    res.status(201).json(novoProduto);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT: Atualizar produto existente
app.put('/api/produtos/:id', async (req, res) => {
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
  ];

  const fieldsToUpdate = Object.keys(patch).filter((key) =>
    allowedFields.includes(key),
  );

  if (fieldsToUpdate.length === 0) {
    return res
      .status(400)
      .json({ error: 'Nenhum campo válido para atualização foi fornecido.' });
  }

  const setClause = fieldsToUpdate
    .map((field, index) => `"${field}" = $${index + 1}`)
    .join(', ');

  const values = fieldsToUpdate.map((key) => patch[key]);

  const sql = `
        UPDATE produtos 
        SET ${setClause}, "atualizadoEm" = $${values.length + 1} 
        WHERE id = $${values.length + 2}
        RETURNING *
    `;

  const params = [...values, nowISO(), id];

  try {
    const result = await pool.query(sql, params);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Produto não encontrado.' });
    }

    const updatedProduct = result.rows[0];
    res.status(200).json(updatedProduct);
  } catch (err) {
    console.error('Erro ao atualizar produto:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE: Deletar produto
app.delete('/api/produtos/:id', async (req, res) => {
  const { id } = req.params;
  const sql = 'DELETE FROM produtos WHERE id = $1';

  try {
    const result = await pool.query(sql, [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Product not found.' });
    }
    res
      .status(200)
      .json({ message: 'Product and its movements have been deleted.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST: Criar movimentação (com transação)
app.post('/api/movimentacoes', async (req, res) => {
  const { produtoId, tipo, quantidade, motivo } = req.body;

  if (!produtoId || !tipo || !quantidade || Number(quantidade) <= 0) {
    return res.status(400).json({ error: 'Invalid movement data.' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const getProductSql = 'SELECT * FROM produtos WHERE id = $1 FOR UPDATE';
    const productResult = await client.query(getProductSql, [produtoId]);
    const produto = productResult.rows[0];

    if (!produto) {
      throw new Error('Product not found for movement.');
    }

    let novaQuantidade;
    if (tipo === 'ajuste') {
      novaQuantidade = Number(quantidade);
    } else {
      const delta =
        tipo === 'entrada' ? Number(quantidade) : -Number(quantidade);
      novaQuantidade = produto.quantidade + delta;
    }
    novaQuantidade = Math.max(0, novaQuantidade);

    const updateSql =
      'UPDATE produtos SET quantidade = $1, "atualizadoEm" = $2 WHERE id = $3';
    await client.query(updateSql, [novaQuantidade, nowISO(), produtoId]);

    const novaMov = {
      id: uid(),
      produtoId,
      tipo,
      quantidade: Number(quantidade),
      motivo: motivo || null,
      criadoEm: nowISO(),
    };
    const insertMovSql =
      'INSERT INTO movimentacoes (id, "produtoId", tipo, quantidade, motivo, "criadoEm") VALUES ($1, $2, $3, $4, $5, $6)';
    await client.query(insertMovSql, [
      novaMov.id,
      novaMov.produtoId,
      novaMov.tipo,
      novaMov.quantidade,
      novaMov.motivo,
      novaMov.criadoEm,
    ]);

    const getUpdatedProductSql = 'SELECT * FROM produtos WHERE id = $1';
    const updatedProductResult = await client.query(getUpdatedProductSql, [
      produtoId,
    ]);

    await client.query('COMMIT');

    res
      .status(201)
      .json({ movimentacao: novaMov, produto: updatedProductResult.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.message === 'Product not found for movement.') {
      res.status(404).json({ error: err.message });
    } else {
      res.status(500).json({ error: `Transaction failed: ${err.message}` });
    }
  } finally {
    client.release();
  }
});

// ROTA DE DIAGNÓSTICO
app.get('/api/debug-schema', async (req, res) => {
  try {
    const sql = `
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'produtos';
    `;
    const { rows } = await pool.query(sql);
    res.json(rows);
  } catch (err) {
    res.status(500).json({
      error: 'Erro ao buscar o schema da tabela.',
      message: err.message,
    });
  }
});

// --- INICIAR O SERVIDOR ---
app.listen(PORT, () => {
  console.log(`🚀 Backend server running at http://localhost:${PORT}`);
});
