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
  console.log("Iniciando a configuração do banco de dados...");

  // Script SQL com nomes em minúsculas para consistência
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
      atualizadoem TIMESTAMPTZ
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

// --- ROTAS DA API ---

// GET: Listar todos os produtos
app.get('/api/produtos', async (req, res) => {
  try {
    const sql = 'SELECT * FROM produtos ORDER BY nome ASC';
    const { rows } = await pool.query(sql);
    // Converte os nomes das colunas para camelCase para o frontend
    const camelCaseRows = rows.map(row => {
        const newRow = {};
        for (const key in row) {
            const camelKey = key.replace(/([-_][a-z])/ig, ($1) => {
                return $1.toUpperCase().replace('-', '').replace('_', '');
            });
            newRow[camelKey] = row[key];
        }
        return newRow;
    });
    res.json(camelCaseRows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET: Listar todas as movimentações
app.get('/api/movimentacoes', async (req, res) => {
    try {
        const sql = 'SELECT * FROM movimentacoes ORDER BY criadoem DESC';
        const { rows } = await pool.query(sql);
        // Converte os nomes das colunas para camelCase para o frontend
        const camelCaseRows = rows.map(row => {
            const newRow = {};
            for (const key in row) {
                const camelKey = key.replace(/([-_][a-z])/ig, ($1) => {
                    return $1.toUpperCase().replace('-', '').replace('_', '');
                });
                newRow[camelKey] = row[key];
            }
            return newRow;
        });
        res.json(camelCaseRows);
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
  
  // O frontend envia camelCase, mas o banco de dados espera minúsculas.
  const novoProduto = {
    id: uid(),
    sku: gerarSKU(),
    nome,
    descricao: descricao || null,
    categoria: categoria || null,
    unidade,
    quantidade: Number(quantidade) || 0,
    estoqueminimo: Number(estoqueMinimo) || null,
    localarmazenamento: localArmazenamento || null,
    fornecedor: fornecedor || null,
    criadoem: nowISO(),
    atualizadoem: null,
  };

  const sql = `
    INSERT INTO produtos (id, sku, nome, descricao, categoria, unidade, quantidade, estoqueminimo, localarmazenamento, fornecedor, criadoem, atualizadoem) 
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *
  `;

  const params = [
    novoProduto.id, novoProduto.sku, novoProduto.nome, novoProduto.descricao, novoProduto.categoria,
    novoProduto.unidade, novoProduto.quantidade, novoProduto.estoqueminimo, novoProduto.localarmazenamento,
    novoProduto.fornecedor, novoProduto.criadoem, novoProduto.atualizadoem
  ];

  try {
    const { rows } = await pool.query(sql, params);
    // Converte a resposta de volta para camelCase para o frontend
    const newRow = {};
    for (const key in rows[0]) {
        const camelKey = key.replace(/([-_][a-z])/ig, ($1) => {
            return $1.toUpperCase().replace('-', '').replace('_', '');
        });
        newRow[camelKey] = rows[0][key];
    }
    res.status(201).json(newRow);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT: Atualizar produto existente
app.put('/api/produtos/:id', async (req, res) => {
    const { id } = req.params;
    const patch = req.body;

    const allowedFields = [
        'nome', 'descricao', 'categoria', 'unidade', 'estoqueMinimo', 
        'localArmazenamento', 'fornecedor'
    ];

    const fieldsToUpdate = Object.keys(patch)
        .filter(key => allowedFields.includes(key));

    if (fieldsToUpdate.length === 0) {
        return res.status(400).json({ error: 'Nenhum campo válido para atualização foi fornecido.' });
    }

    // CONVERTE OS CAMPOS PARA MINÚSCULAS PARA O SQL
    const setClause = fieldsToUpdate
        .map((field, index) => `${field.toLowerCase()} = $${index + 1}`)
        .join(', ');

    const values = fieldsToUpdate.map(key => patch[key]);

    const sql = `
        UPDATE produtos 
        SET ${setClause}, atualizadoem = $${values.length + 1} 
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
        // Converte a resposta de volta para camelCase para o frontend
        const newRow = {};
        for (const key in updatedProduct) {
            const camelKey = key.replace(/([-_][a-z])/ig, ($1) => {
                return $1.toUpperCase().replace('-', '').replace('_', '');
            });
            newRow[camelKey] = updatedProduct[key];
        }
        res.status(200).json(newRow);

    } catch (err) {
        console.error("Erro ao atualizar produto:", err.message);
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
        if (tipo === "ajuste") {
            novaQuantidade = Number(quantidade);
        } else {
            const delta = tipo === "entrada" ? Number(quantidade) : -Number(quantidade);
            novaQuantidade = produto.quantidade + delta;
        }
        novaQuantidade = Math.max(0, novaQuantidade);

        const updateSql = 'UPDATE produtos SET quantidade = $1, atualizadoem = $2 WHERE id = $3';
        await client.query(updateSql, [novaQuantidade, nowISO(), produtoId]);
        
        const novaMov = {
            id: uid(),
            produtoid: produtoId,
            tipo,
            quantidade: Number(quantidade),
            motivo: motivo || null,
            criadoem: nowISO()
        };
        const insertMovSql = 'INSERT INTO movimentacoes (id, produtoid, tipo, quantidade, motivo, criadoem) VALUES ($1, $2, $3, $4, $5, $6)';
        await client.query(insertMovSql, [novaMov.id, novaMov.produtoid, novaMov.tipo, novaMov.quantidade, novaMov.motivo, novaMov.criadoem]);

        const getUpdatedProductSql = 'SELECT * FROM produtos WHERE id = $1';
        const updatedProductResult = await client.query(getUpdatedProductSql, [produtoId]);
        
        await client.query('COMMIT');

        // Converte as respostas para camelCase para o frontend
        const movCamelCase = {};
        for (const key in novaMov) {
            movCamelCase[key.replace(/([-_][a-z])/ig, $1 => $1.toUpperCase().replace('_', '').replace('-', ''))] = novaMov[key];
        }
        const produtoCamelCase = {};
        for (const key in updatedProductResult.rows[0]) {
            produtoCamelCase[key.replace(/([-_][a-z])/ig, $1 => $1.toUpperCase().replace('_', '').replace('-', ''))] = updatedProductResult.rows[0][key];
        }

        res.status(201).json({ movimentacao: movCamelCase, produto: produtoCamelCase });

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


// --- INICIAR O SERVIDOR ---
app.listen(PORT, () => {
  console.log(`🚀 Backend server running at http://localhost:${PORT}`);
});