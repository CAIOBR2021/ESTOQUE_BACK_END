// services/emailService.js
const nodemailer = require('nodemailer');
require('dotenv').config();

// 1. Configura o "transporter" que fará o envio do e-mail
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: parseInt(process.env.EMAIL_PORT, 10),
  secure: false, // true para porta 465, false para as outras
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

/**
 * Envia um e-mail de notificação de estoque baixo.
 * A função é "fire-and-forget", não bloqueia a resposta da API.
 * @param {object} produto - O objeto do produto (já em camelCase) que está com estoque baixo.
 */
function sendLowStockEmail(produto) {
  // Verificação para garantir que os dados necessários existem
  if (!produto || typeof produto.estoqueMinimo === 'undefined' || !process.env.EMAIL_RECIPIENTS) {
    return;
  }

  console.log(`Tentando enviar notificação para o produto: ${produto.nome}`);

  const mailOptions = {
    from: `"Sistema de Estoque" <${process.env.EMAIL_USER}>`,
    to: process.env.EMAIL_RECIPIENTS, // Pega os destinatários do .env
    subject: `⚠️ Alerta de Estoque Baixo: ${produto.nome}`,
    html: `
      <h1>Alerta de Estoque Baixo</h1>
      <p>O produto abaixo atingiu ou ficou abaixo do nível mínimo de estoque definido.</p>
      <table border="1" cellpadding="10" cellspacing="0" style="border-collapse: collapse;">
        <tr>
          <td style="background-color: #f2f2f2;"><strong>SKU</strong></td>
          <td>${produto.sku}</td>
        </tr>
        <tr>
          <td style="background-color: #f2f2f2;"><strong>Nome</strong></td>
          <td>${produto.nome}</td>
        </tr>
        <tr>
          <td style="background-color: #f2f2f2;"><strong>Estoque Atual</strong></td>
          <td style="color: red; font-weight: bold;">${produto.quantidade} ${produto.unidade}</td>
        </tr>
        <tr>
          <td style="background-color: #f2f2f2;"><strong>Estoque Mínimo</strong></td>
          <td>${produto.estoqueMinimo} ${produto.unidade}</td>
        </tr>
      </table>
      <p>Por favor, providencie a reposição do item o mais rápido possível.</p>
    `,
  };

  // Enviamos o e-mail e lidamos com sucesso ou erro de forma assíncrona
  transporter.sendMail(mailOptions)
    .then(info => {
      console.log(`E-mail de alerta enviado com sucesso para ${produto.nome}. ID: ${info.messageId}`);
    })
    .catch(error => {
      console.error(`ERRO ao enviar e-mail de notificação para ${produto.nome}:`, error);
    });
}

module.exports = { sendLowStockEmail };