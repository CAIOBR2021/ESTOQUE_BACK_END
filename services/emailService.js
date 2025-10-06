// services/emailService.js
const { Resend } = require('resend');
require('dotenv').config();

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Envia um e-mail de notificação de estoque baixo.
 * A função é "fire-and-forget", não bloqueia a resposta da API.
 * @param {object} produto - O objeto do produto (já em camelCase) que está com estoque baixo.
 */
async function sendLowStockEmail(produto) {
  // Verificação para garantir que os dados necessários existem
  if (
    !produto ||
    typeof produto.estoqueMinimo === 'undefined' ||
    !process.env.EMAIL_RECIPIENTS
  ) {
    return;
  }

  console.log(`Tentando enviar notificação para o produto: ${produto.nome}`);

  try {
    const { data, error } = await resend.emails.send({
      from: 'Sistema de Estoque <onboarding@resend.dev>', // Atualize para o seu email verificado no Resend
      to: process.env.EMAIL_RECIPIENTS.split(',').map((email) => email.trim()),
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
    });

    if (error) {
      console.error(
        `ERRO ao enviar e-mail de notificação para ${produto.nome}:`,
        error,
      );
      return;
    }

    console.log(
      `E-mail de alerta enviado com sucesso para ${produto.nome}. ID: ${data.id}`,
    );
  } catch (error) {
    console.error(
      `ERRO ao enviar e-mail de notificação para ${produto.nome}:`,
      error,
    );
  }
}

module.exports = { sendLowStockEmail };
