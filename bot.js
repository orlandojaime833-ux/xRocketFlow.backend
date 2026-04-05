const { Telegraf } = require('telegraf');
const express = require('express');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);

if (!BOT_TOKEN) {
    console.error('❌ ERRO: BOT_TOKEN não configurado!');
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const app = express();

bot.start((ctx) => {
    ctx.reply('🚀 Bot ROCKET FLOW funcionando!');
});

const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot rodando!'));
app.listen(PORT, () => {
    console.log(`✅ Servidor rodando na porta ${PORT}`);
    bot.launch();
    console.log('🤖 Bot iniciado!');
});
