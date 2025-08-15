const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
// Usando 'pg' para um API moderna baseada em Promises
const { Pool } = require('pg');

// --- CONFIGURAÇÃO INICIAL ---
const app = express();
const PORT = process.env.PORT || 10000; // Usar a porta do ambiente ou 10000

// Middlewares
app.use(cors());
app.use(express.json());

// --- BANCO DE DADOS (PostgreSQL) ---
// A URL de conexão será injetada pelo ambiente de hospedagem (Render, Railway)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Adicionar configuração SSL se o provedor exigir (Render exige)
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

pool.connect()
  .then(() => {
    console.log("PostgreSQL database connected successfully.");
    setupDatabase();
  })
  .catch(err => console.error("Error connecting to the database:", err.message));


// Função para criar as tabelas se não existirem
async function setupDatabase() {
  console.log("Iniciando a configuração do banco de dados..."); // Log de início

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
      "criadoEm" TIMESTAMPTZ NOT NULL
      "atualizadoEm" TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS movimentacoes (
      id UUID PRIMARY KEY,
      "produtoId" UUID NOT NULL,
      tipo TEXT NOT NULL,
      quantidade INTEGER NOT NULL,
      motivo TEXT,
      "criadoEm" TIMESTAMPTZ NOT NULL,
      FOREIGN KEY ("produtoId") REFERENCES produtos (id) ON DELETE CASCADE
    );
  `;

  try {
    await pool.query(createTablesScript);
    console.log("SUCESSO: Tabelas do banco de dados verificadas/criadas com sucesso.");
  } catch (err) {
    console.error("ERRO CRÍTICO AO CRIAR TABELAS:", err);
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

// --- ROTAS DA API (convertidas para async/await) ---

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
  const { nome, descricao, categoria, unidade, quantidade, estoqueMinimo, localArmazenamento, fornecedor } = req.body;

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
    novoProduto.id, novoProduto.sku, novoProduto.nome, novoProduto.descricao, novoProduto.categoria,
    novoProduto.unidade, novoProduto.quantidade, novoProduto.estoqueMinimo, novoProduto.localArmazenamento,
    novoProduto.fornecedor, novoProduto.criadoEm, novoProduto.atualizadoEm
  ];

  try {
    await pool.query(sql, params);
    res.status(201).json(novoProduto);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT: Atualizar produto existente (VERSÃO CORRIGIDA E SEGURA)
app.put('/api/produtos/:id', async (req, res) => {
    const { id } = req.params;
    const patch = req.body;

    // 1. Defina os campos que são permitidos para atualização
    const allowedFields = [
        'nome', 'descricao', 'categoria', 'unidade', 'estoqueMinimo', 
        'localArmazenamento', 'fornecedor'
        // 'quantidade' é intencionalmente deixada de fora, pois deve ser alterada apenas por movimentações.
    ];

    // 2. Filtre o corpo da requisição para usar apenas os campos permitidos
    const fieldsToUpdate = Object.keys(patch)
        .filter(key => allowedFields.includes(key));

    if (fieldsToUpdate.length === 0) {
        return res.status(400).json({ error: 'Nenhum campo válido para atualização foi fornecido.' });
    }

    // 3. Monte a query dinamicamente de forma segura
    const setClause = fieldsToUpdate
        .map((field, index) => `"${field}" = $${index + 1}`)
        .join(', ');

    const values = fieldsToUpdate.map(key => patch[key]);

    // 4. Use "RETURNING *" para que o PostgreSQL devolva o produto atualizado
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
        
        // 5. Envie o produto atualizado de volta para o frontend
        const updatedProduct = result.rows[0];
        res.status(200).json(updatedProduct);

    } catch (err) {
        console.error("Erro ao atualizar produto:", err.message); // Adiciona um log mais claro no servidor
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
        res.status(200).json({ message: 'Product and its movements have been deleted.' });
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

    const client = await pool.connect(); // Pega uma conexão do pool para a transação

    try {
        await client.query('BEGIN');

        // 1. Busca o produto
        const getProductSql = 'SELECT * FROM produtos WHERE id = $1 FOR UPDATE'; // FOR UPDATE bloqueia a linha
        const productResult = await client.query(getProductSql, [produtoId]);
        const produto = productResult.rows[0];

        if (!produto) {
            throw new Error('Product not found for movement.');
        }

        // 2. Calcula a nova quantidade
        let novaQuantidade;
        if (tipo === "ajuste") {
            novaQuantidade = Number(quantidade);
        } else {
            const delta = tipo === "entrada" ? Number(quantidade) : -Number(quantidade);
            novaQuantidade = produto.quantidade + delta;
        }
        novaQuantidade = Math.max(0, novaQuantidade);

        // 3. Atualiza o produto
        const updateSql = 'UPDATE produtos SET quantidade = $1, "atualizadoEm" = $2 WHERE id = $3';
        await client.query(updateSql, [novaQuantidade, nowISO(), produtoId]);
        
        // 4. Insere a movimentação
        const novaMov = {
            id: uid(),
            produtoId,
            tipo,
            quantidade: Number(quantidade),
            motivo: motivo || null,
            criadoEm: nowISO()
        };
        const insertMovSql = 'INSERT INTO movimentacoes (id, "produtoId", tipo, quantidade, motivo, "criadoEm") VALUES ($1, $2, $3, $4, $5, $6)';
        await client.query(insertMovSql, [novaMov.id, novaMov.produtoId, novaMov.tipo, novaMov.quantidade, novaMov.motivo, novaMov.criadoEm]);

        // 5. Busca o produto atualizado
        const getUpdatedProductSql = 'SELECT * FROM produtos WHERE id = $1';
        const updatedProductResult = await client.query(getUpdatedProductSql, [produtoId]);
        
        await client.query('COMMIT'); // Efetiva a transação

        res.status(201).json({ movimentacao: novaMov, produto: updatedProductResult.rows[0] });

    } catch (err) {
        await client.query('ROLLBACK'); // Desfaz a transação em caso de erro
        if (err.message === 'Product not found for movement.') {
            res.status(404).json({ error: err.message });
        } else {
            res.status(500).json({ error: `Transaction failed: ${err.message}` });
        }
    } finally {
        client.release(); // Libera a conexão de volta para o pool
    }
});


// --- INICIAR O SERVIDOR ---
app.listen(PORT, () => {
  console.log(`🚀 Backend server running at http://localhost:${PORT}`);
});