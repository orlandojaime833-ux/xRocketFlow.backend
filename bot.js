const { Telegraf, Markup } = require('telegraf');
const express = require('express');

const BOT_TOKEN = 8642593414:AAFqmvDEUTql_8dJ3sZHc7qtEwOO-vAriTY;
const ADMIN_ID = 7991785009;

const bot = new Telegraf(BOT_TOKEN);
const app = express();

let produtos = [];
let carrinho = new Map();

const mainMenu = Markup.inlineKeyboard([
    [Markup.button.callback('🛍️ PRODUTOS', 'products')],
    [Markup.button.callback('🛒 CARRINHO', 'cart')],
    [Markup.button.callback('⚙️ ADMIN', 'admin')]
]);

const adminMenu = Markup.inlineKeyboard([
    [Markup.button.callback('➕ Add Produto', 'add_product')],
    [Markup.button.callback('📋 Listar', 'list_products')],
    [Markup.button.callback('🔙 Voltar', 'back')]
]);

bot.start(async (ctx) => {
    const isAdmin = ctx.from.id === ADMIN_ID;
    await ctx.reply(
        '🚀 ROCKET FLOW BOT\n\n' +
        (isAdmin ? '👑 Modo Admin\n\n' : '👤 Cliente\n\n') +
        'Use os botoes:',
        { ...mainMenu }
    );
});

bot.action('products', async (ctx) => {
    if (produtos.length === 0) {
        return ctx.reply('Nenhum produto.');
    }
    let msg = 'PRODUTOS:\n\n';
    const btns = [];
    for (let i = 0; i < produtos.length; i++) {
        msg += i + 1 + '. ' + produtos[i].nome + ' - R$' + produtos[i].preco + '\n';
        btns.push([Markup.button.callback('Comprar ' + produtos[i].nome, 'add_' + i)]);
    }
    btns.push([Markup.button.callback('Voltar', 'back')]);
    await ctx.reply(msg, { ...Markup.inlineKeyboard(btns) });
});

bot.action(/add_(\d+)/, async (ctx) => {
    const idx = parseInt(ctx.match[1]);
    const prod = produtos[idx];
    if (!prod) return;
    let cart = carrinho.get(ctx.from.id) || [];
    cart.push(prod);
    carrinho.set(ctx.from.id, cart);
    await ctx.answerCbQuery('Adicionado: ' + prod.nome);
});

bot.action('cart', async (ctx) => {
    const cart = carrinho.get(ctx.from.id) || [];
    if (cart.length === 0) {
        return ctx.reply('Carrinho vazio.');
    }
    let total = 0;
    let msg = 'SEU CARRINHO:\n\n';
    for (const item of cart) {
        total += item.preco;
        msg += item.nome + ' - R$' + item.preco + '\n';
    }
    msg += '\nTOTAL: R$' + total;
    await ctx.reply(msg, {
        ...Markup.inlineKeyboard([
            [Markup.button.callback('Finalizar', 'checkout')],
            [Markup.button.callback('Limpar', 'clear_cart')],
            [Markup.button.callback('Voltar', 'back')]
        ])
    });
});

bot.action('checkout', async (ctx) => {
    const cart = carrinho.get(ctx.from.id) || [];
    if (cart.length === 0) return;
    const total = cart.reduce((s, p) => s + p.preco, 0);
    await ctx.reply('Pagamento: R$' + total + '\n\nEm breve integracao com xRocket!');
    carrinho.delete(ctx.from.id);
});

bot.action('clear_cart', async (ctx) => {
    carrinho.delete(ctx.from.id);
    await ctx.answerCbQuery('Carrinho limpo!');
    await ctx.reply('Carrinho esvaziado.', { ...mainMenu });
});

bot.action('admin', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) {
        return ctx.reply('Acesso negado!');
    }
    await ctx.reply('Painel Admin', { ...adminMenu });
});

bot.action('add_product', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    ctx.session = { step: 'awaiting_product' };
    await ctx.reply('Envie o produto no formato:\nNome\nPreco\n\nExemplo:\nCurso JS\n49.90');
});

bot.action('list_products', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    if (produtos.length === 0) return ctx.reply('Nenhum produto.');
    let msg = 'PRODUTOS CADASTRADOS:\n\n';
    produtos.forEach((p, i) => {
        msg += i + 1 + '. ' + p.nome + ' - R$' + p.preco + '\n';
    });
    await ctx.reply(msg);
});

bot.action('back', async (ctx) => {
    await ctx.reply('Menu Principal', { ...mainMenu });
});

bot.on('text', async (ctx) => {
    if (ctx.session?.step === 'awaiting_product' && ctx.from.id === ADMIN_ID) {
        const lines = ctx.message.text.split('\n');
        if (lines.length < 2) {
            return ctx.reply('Formato invalido! Use:\nNome\nPreco');
        }
        const nome = lines[0].trim();
        const preco = parseFloat(lines[1]);
        if (isNaN(preco)) {
            return ctx.reply('Preco invalido!');
        }
        produtos.push({ nome, preco });
        await ctx.reply('Produto adicionado: ' + nome + ' - R$' + preco);
        ctx.session = {};
    }
});

const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot rodando!'));
app.listen(PORT, () => {
    console.log('Servidor rodando na porta ' + PORT);
    bot.launch();
    console.log('Bot iniciado!');
});
