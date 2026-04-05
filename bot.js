const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const express = require('express');

// ============ CONFIGURAÇÕES COM SUAS VARIÁVEIS ============
const BOT_TOKEN = '8763858505:AAFPNh6V5-j0J4hF_is0OYuLci5HDtPeZgU';
const GEMINI_API_KEY = 'AIzaSyBbFcGJYvNN-b-i2tlkiZrY7jZ_pjEij4A';
const XROCKET_API = 'c01709a9c058bd25eeefea6b2';
const ADMIN_ID = 7991785009;

// ============ PROMPT IA ============
const IA_PROMPT = `Você é um copywriter especialista em vendas. Crie uma descrição atraente, persuasiva e curta para o seguinte produto. Use emojis e destaque benefícios. Máximo 200 caracteres.`;

const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use(express.json());

// ============ BANCO DE DADOS ============
let produtos = [];
let carrinho = new Map();
let cupons = [
    { codigo: 'ROCKET10', desconto: 10, tipo: 'percentual', ativo: true },
    { codigo: 'FREEBOSS', desconto: 100, tipo: 'percentual', ativo: true }
];

// ============ FUNÇÃO IA GEMINI ============
async function gerarDescricaoComIA(nomeProduto) {
    if (!GEMINI_API_KEY) return null;
    
    try {
        const response = await axios.post(
            'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
            {
                contents: [{
                    parts: [{ text: `${IA_PROMPT}\n\nProduto: ${nomeProduto}` }]
                }],
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 150,
                    topP: 0.9
                }
            },
            {
                params: { key: GEMINI_API_KEY },
                headers: { 'Content-Type': 'application/json' },
                timeout: 10000
            }
        );
        
        const descricao = response.data.candidates?.[0]?.content?.parts?.[0]?.text || null;
        return descricao ? descricao.replace(/\n/g, ' ').substring(0, 200) : null;
    } catch (error) {
        console.error('❌ Erro na IA:', error.message);
        return null;
    }
}

// ============ FUNÇÃO PAGAMENTO xROCKET ============
async function criarPagamento(items, compradorId, cupom = null) {
    if (!XROCKET_API) return null;
    
    let total = items.reduce((s, i) => s + (i.preco * (i.qtd || 1)), 0);
    
    if (cupom) {
        if (cupom.tipo === 'percentual') {
            total *= (1 - cupom.desconto / 100);
        } else {
            total = Math.max(0, total - cupom.desconto);
        }
    }
    
    try {
        const res = await axios.post(
            'https://api.xrocketpay.com/v1/invoice',
            {
                amount: parseFloat(total.toFixed(2)),
                currency: 'USDT',
                description: `Compra de ${items.length} produto(s)`,
                external_id: `order_${compradorId}_${Date.now()}`,
                expires_in: 3600
            },
            {
                headers: { 'Authorization': `Bearer ${XROCKET_API}` },
                timeout: 10000
            }
        );
        
        return { url: res.data.payment_url, total: total };
    } catch (error) {
        console.error('❌ Erro no pagamento:', error.message);
        return null;
    }
}

function isAdmin(ctx) {
    return ctx.from.id === ADMIN_ID;
}

// ============ MENUS ============
const mainMenu = Markup.inlineKeyboard([
    [Markup.button.callback('🛍️ PRODUTOS', 'products')],
    [Markup.button.callback('🛒 CARRINHO', 'cart')],
    [Markup.button.callback('🎫 CUPONS', 'coupons')],
    [Markup.button.callback('⚙️ ADMIN', 'admin')]
]);

const adminMenu = Markup.inlineKeyboard([
    [Markup.button.callback('➕ Add com IA', 'add_ia')],
    [Markup.button.callback('➕ Add manual', 'add_manual')],
    [Markup.button.callback('📋 Listar produtos', 'list')],
    [Markup.button.callback('🎫 Criar cupom', 'create_coupon')],
    [Markup.button.callback('🔙 Voltar', 'back')]
]);

// ============ COMANDO START ============
bot.start(async (ctx) => {
    const adminStatus = isAdmin(ctx) ? '👑 ADMINISTRADOR' : '👤 CLIENTE';
    
    await ctx.reply(
        `🚀 *Bem-vindo ao ROCKET FLOW!*\n\n` +
        `📌 *Status:* ${adminStatus}\n` +
        `📦 *Produtos:* ${produtos.length}\n` +
        `🤖 *IA Gemini:* ${GEMINI_API_KEY ? 'ATIVA ✅' : 'INATIVA ⚠️'}\n\n` +
        `Use os botões abaixo:`,
        {
            parse_mode: 'Markdown',
            ...mainMenu
        }
    );
});

// ============ PRODUTOS ============
bot.action('products', async (ctx) => {
    if (produtos.length === 0) {
        return ctx.reply('📦 *Nenhum produto disponível.*', { parse_mode: 'Markdown' });
    }
    
    let msg = '*🛍️ CATÁLOGO DE PRODUTOS:*\n\n';
    const btns = [];
    
    for (let i = 0; i < produtos.length; i++) {
        const p = produtos[i];
        msg += `*${p.nome}*\n`;
        msg += `💰 Preço: *$${p.preco} USDT*\n`;
        msg += `📝 ${p.descricao || 'Sem descrição'}\n`;
        msg += `━━━━━━━━━━━━━━━━\n\n`;
        btns.push([Markup.button.callback(`➕ Adicionar`, `add_${i}`)]);
    }
    
    btns.push([Markup.button.callback('🔙 Voltar', 'back')]);
    
    await ctx.reply(msg, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(btns)
    });
});

// ============ ADICIONAR AO CARRINHO ============
bot.action(/add_(\d+)/, async (ctx) => {
    const idx = parseInt(ctx.match[1]);
    const prod = produtos[idx];
    
    if (!prod) {
        return ctx.answerCbQuery('❌ Produto não encontrado!');
    }
    
    let cart = carrinho.get(ctx.from.id) || [];
    const existente = cart.find(p => p.id === idx);
    
    if (existente) {
        existente.qtd = (existente.qtd || 1) + 1;
    } else {
        cart.push({ ...prod, id: idx, qtd: 1 });
    }
    
    carrinho.set(ctx.from.id, cart);
    await ctx.answerCbQuery(`✅ ${prod.nome} adicionado!`);
});

// ============ VER CARRINHO ============
bot.action('cart', async (ctx) => {
    const cart = carrinho.get(ctx.from.id) || [];
    
    if (cart.length === 0) {
        return ctx.reply('🛒 *Carrinho vazio!*', { parse_mode: 'Markdown' });
    }
    
    let msg = '*🛒 SEU CARRINHO:*\n\n';
    let total = 0;
    
    for (const item of cart) {
        const subtotal = item.preco * (item.qtd || 1);
        total += subtotal;
        msg += `*${item.nome}*\n`;
        msg += `💰 $${item.preco} x ${item.qtd || 1} = *$${subtotal.toFixed(2)}*\n`;
        msg += `━━━━━━━━━━━━━━━━\n\n`;
    }
    
    msg += `\n💰 *TOTAL: $${total.toFixed(2)} USDT*`;
    
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const express = require('express');

// ============ CONFIGURAÇÕES COM SUAS VARIÁVEIS ============
const BOT_TOKEN = '8763858505:AAFPNh6V5-j0J4hF_is0OYuLci5HDtPeZgU';
const GEMINI_API_KEY = 'AIzaSyBbFcGJYvNN-b-i2tlkiZrY7jZ_pjEij4A';
const XROCKET_API = 'c01709a9c058bd25eeefea6b2';
const ADMIN_ID = 7991785009;

// ============ PROMPT IA ============
const IA_PROMPT = `Você é um copywriter especialista em vendas. Crie uma descrição atraente, persuasiva e curta para o seguinte produto. Use emojis e destaque benefícios. Máximo 200 caracteres.`;

const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use(express.json());

// ============ BANCO DE DADOS ============
let produtos = [];
let carrinho = new Map();
let cupons = [
    { codigo: 'ROCKET10', desconto: 10, tipo: 'percentual', ativo: true },
    { codigo: 'FREEBOSS', desconto: 100, tipo: 'percentual', ativo: true }
];

// ============ FUNÇÃO IA GEMINI ============
async function gerarDescricaoComIA(nomeProduto) {
    if (!GEMINI_API_KEY) return null;
    
    try {
        const response = await axios.post(
            'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
            {
                contents: [{
                    parts: [{ text: `${IA_PROMPT}\n\nProduto: ${nomeProduto}` }]
                }],
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 150,
                    topP: 0.9
                }
            },
            {
                params: { key: GEMINI_API_KEY },
                headers: { 'Content-Type': 'application/json' },
                timeout: 10000
            }
        );
        
        const descricao = response.data.candidates?.[0]?.content?.parts?.[0]?.text || null;
        return descricao ? descricao.replace(/\n/g, ' ').substring(0, 200) : null;
    } catch (error) {
        console.error('❌ Erro na IA:', error.message);
        return null;
    }
}

// ============ FUNÇÃO PAGAMENTO xROCKET ============
async function criarPagamento(items, compradorId, cupom = null) {
    if (!XROCKET_API) return null;
    
    let total = items.reduce((s, i) => s + (i.preco * (i.qtd || 1)), 0);
    
    if (cupom) {
        if (cupom.tipo === 'percentual') {
            total *= (1 - cupom.desconto / 100);
        } else {
            total = Math.max(0, total - cupom.desconto);
        }
    }
    
    try {
        const res = await axios.post(
            'https://api.xrocketpay.com/v1/invoice',
            {
                amount: parseFloat(total.toFixed(2)),
                currency: 'USDT',
                description: `Compra de ${items.length} produto(s)`,
                external_id: `order_${compradorId}_${Date.now()}`,
                expires_in: 3600
            },
            {
                headers: { 'Authorization': `Bearer ${XROCKET_API}` },
                timeout: 10000
            }
        );
        
        return { url: res.data.payment_url, total: total };
    } catch (error) {
        console.error('❌ Erro no pagamento:', error.message);
        return null;
    }
}

function isAdmin(ctx) {
    return ctx.from.id === ADMIN_ID;
}

// ============ MENUS ============
const mainMenu = Markup.inlineKeyboard([
    [Markup.button.callback('🛍️ PRODUTOS', 'products')],
    [Markup.button.callback('🛒 CARRINHO', 'cart')],
    [Markup.button.callback('🎫 CUPONS', 'coupons')],
    [Markup.button.callback('⚙️ ADMIN', 'admin')]
]);

const adminMenu = Markup.inlineKeyboard([
    [Markup.button.callback('➕ Add com IA', 'add_ia')],
    [Markup.button.callback('➕ Add manual', 'add_manual')],
    [Markup.button.callback('📋 Listar produtos', 'list')],
    [Markup.button.callback('🎫 Criar cupom', 'create_coupon')],
    [Markup.button.callback('🔙 Voltar', 'back')]
]);

// ============ COMANDO START ============
bot.start(async (ctx) => {
    const adminStatus = isAdmin(ctx) ? '👑 ADMINISTRADOR' : '👤 CLIENTE';
    
    await ctx.reply(
        `🚀 *Bem-vindo ao ROCKET FLOW!*\n\n` +
        `📌 *Status:* ${adminStatus}\n` +
        `📦 *Produtos:* ${produtos.length}\n` +
        `🤖 *IA Gemini:* ${GEMINI_API_KEY ? 'ATIVA ✅' : 'INATIVA ⚠️'}\n\n` +
        `Use os botões abaixo:`,
        {
            parse_mode: 'Markdown',
            ...mainMenu
        }
    );
});

// ============ PRODUTOS ============
bot.action('products', async (ctx) => {
    if (produtos.length === 0) {
        return ctx.reply('📦 *Nenhum produto disponível.*', { parse_mode: 'Markdown' });
    }
    
    let msg = '*🛍️ CATÁLOGO DE PRODUTOS:*\n\n';
    const btns = [];
    
    for (let i = 0; i < produtos.length; i++) {
        const p = produtos[i];
        msg += `*${p.nome}*\n`;
        msg += `💰 Preço: *$${p.preco} USDT*\n`;
        msg += `📝 ${p.descricao || 'Sem descrição'}\n`;
        msg += `━━━━━━━━━━━━━━━━\n\n`;
        btns.push([Markup.button.callback(`➕ Adicionar`, `add_${i}`)]);
    }
    
    btns.push([Markup.button.callback('🔙 Voltar', 'back')]);
    
    await ctx.reply(msg, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(btns)
    });
});

// ============ ADICIONAR AO CARRINHO ============
bot.action(/add_(\d+)/, async (ctx) => {
    const idx = parseInt(ctx.match[1]);
    const prod = produtos[idx];
    
    if (!prod) {
        return ctx.answerCbQuery('❌ Produto não encontrado!');
    }
    
    let cart = carrinho.get(ctx.from.id) || [];
    const existente = cart.find(p => p.id === idx);
    
    if (existente) {
        existente.qtd = (existente.qtd || 1) + 1;
    } else {
        cart.push({ ...prod, id: idx, qtd: 1 });
    }
    
    carrinho.set(ctx.from.id, cart);
    await ctx.answerCbQuery(`✅ ${prod.nome} adicionado!`);
});

// ============ VER CARRINHO ============
bot.action('cart', async (ctx) => {
    const cart = carrinho.get(ctx.from.id) || [];
    
    if (cart.length === 0) {
        return ctx.reply('🛒 *Carrinho vazio!*', { parse_mode: 'Markdown' });
    }
    
    let msg = '*🛒 SEU CARRINHO:*\n\n';
    let total = 0;
    
    for (const item of cart) {
        const subtotal = item.preco * (item.qtd || 1);
        total += subtotal;
        msg += `*${item.nome}*\n`;
        msg += `💰 $${item.preco} x ${item.qtd || 1} = *$${subtotal.toFixed(2)}*\n`;
        msg += `━━━━━━━━━━━━━━━━\n\n`;
    }
    
    msg += `\n💰 *TOTAL: $${total.toFixed(2)} USDT*`;
    
    await ctx.reply(msg, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ FINALIZAR', 'checkout')],
            [Markup.button.callback('🎫 CUPOM', 'apply_coupon')],
            [Markup.button.callback('🗑️ LIMPAR', 'clear_cart')],
            [Markup.button.callback('🔙 Voltar', 'back')]
        ])
    });
});

// ============ LIMPAR CARRINHO ============
bot.action('clear_cart', async (ctx) => {
    carrinho.delete(ctx.from.id);
    await ctx.answerCbQuery('🗑️ Carrinho limpo!');
    await ctx.reply('✅ *Carrinho esvaziado!*', { parse_mode: 'Markdown', ...mainMenu });
});

// ============ FINALIZAR COMPRA ============
bot.action('checkout', async (ctx) => {
    const cart = carrinho.get(ctx.from.id) || [];
    
    if (cart.length === 0) {
        return ctx.reply('❌ *Carrinho vazio!*', { parse_mode: 'Markdown' });
    }
    
    await ctx.reply('🔄 *Gerando pagamento...*', { parse_mode: 'Markdown' });
    
    const cupomAplicado = ctx.session?.cupom;
    const payment = await criarPagamento(cart, ctx.from.id, cupomAplicado);
    
    if (payment?.url) {
        await ctx.reply(
            `💳 *PAGAMENTO GERADO!*\n\n` +
            `🔗 *Link:* ${payment.url}\n\n` +
            `💰 *Total:* $${payment.total.toFixed(2)} USDT\n` +
            `⏰ *Válido por:* 1 hora`,
            { parse_mode: 'Markdown' }
        );
        carrinho.delete(ctx.from.id);
        delete ctx.session?.cupom;
    } else {
        await ctx.reply(
            '❌ *Erro ao gerar pagamento!*\n\n' +
            'Tente novamente mais tarde.',
            { parse_mode: 'Markdown' }
        );
    }
});

// ============ CUPONS ============
bot.action('coupons', async (ctx) => {
    const cuponsAtivos = cupons.filter(c => c.ativo);
    
    if (cuponsAtivos.length === 0) {
        return ctx.reply('🎫 *Nenhum cupom ativo.*', { parse_mode: 'Markdown' });
    }
    
    let msg = '🎫 *CUPONS DISPONÍVEIS:*\n\n';
    for (const c of cuponsAtivos) {
        msg += `*${c.codigo}* - ${c.desconto}% OFF\n━━━━━━━━━━\n`;
    }
    
    await ctx.reply(msg, { parse_mode: 'Markdown' });
});

bot.action('apply_coupon', async (ctx) => {
    ctx.session = { step: 'awaiting_coupon' };
    await ctx.reply('🎫 *Digite o código do cupom:*\n\nEx: `ROCKET10`', { parse_mode: 'Markdown' });
});

// ============ ADMIN ============
bot.action('admin', async (ctx) => {
    if (!isAdmin(ctx)) {
        return ctx.reply('❌ *Acesso negado!*', { parse_mode: 'Markdown' });
    }
    await ctx.reply('⚙️ *Painel Administrativo*', {
        parse_mode: 'Markdown',
        ...adminMenu
    });
});

// ============ ADMIN: ADD COM IA ============
bot.action('add_ia', async (ctx) => {
    if (!isAdmin(ctx)) return;
    
    ctx.session = { step: 'awaiting_ia_product' };
    await ctx.reply(
        '🤖 *ADICIONAR PRODUTO COM IA*\n\n' +
        'Envie o *NOME* do produto:',
        { parse_mode: 'Markdown' }
    );
});

// ============ ADMIN: ADD MANUAL ============
bot.action('add_manual', async (ctx) => {
    if (!isAdmin(ctx)) return;
    
    ctx.session = { step: 'awaiting_manual_product' };
    await ctx.reply(
        '📝 *ADICIONAR PRODUTO MANUAL*\n\n' +
        'Envie no formato:\n' +
        '`Nome`\n`Preço`\n`Descrição`\n\n' +
        'Exemplo:\n' +
        'Curso de Python\n' +
        '49.90\n' +
        'Curso completo',
        { parse_mode: 'Markdown' }
    );
});

// ============ ADMIN: LISTAR ============
bot.action('list', async (ctx) => {
    if (!isAdmin(ctx)) return;
    
    if (produtos.length === 0) {
        return ctx.reply('📋 *Nenhum produto cadastrado.*', { parse_mode: 'Markdown' });
    }
    
    let msg = '*📋 PRODUTOS CADASTRADOS:*\n\n';
    produtos.forEach((p, i) => {
        msg += `${i + 1}. *${p.nome}*\n`;
        msg += `   💰 $${p.preco}\n`;
        msg += `   📝 ${p.descricao?.substring(0, 50)}...\n\n`;
    });
    
    await ctx.reply(msg, { parse_mode: 'Markdown' });
});

// ============ ADMIN: CRIAR CUPOM ============
bot.action('create_coupon', async (ctx) => {
    if (!isAdmin(ctx)) return;
    
    ctx.session = { step: 'awaiting_coupon_create' };
    await ctx.reply(
        '🎫 *CRIAR CUPOM*\n\n' +
        'Envie: `CODIGO|DESCONTO`\n\n' +
        'Exemplo: `BLACK20|20`',
        { parse_mode: 'Markdown' }
    );
});

// ============ VOLTAR ============
bot.action('back', async (ctx) => {
    await ctx.reply('🏠 *Menu Principal*', {
        parse_mode: 'Markdown',
        ...mainMenu
    });
});

// ============ PROCESSAR TEXTOS ============
bot.on('text', async (ctx) => {
    // Aplicar cupom no carrinho
    if (ctx.session?.step === 'awaiting_coupon') {
        const codigo = ctx.message.text.toUpperCase();
        const cupom = cupons.find(c => c.codigo === codigo && c.ativo);
        
        if (cupom) {
            ctx.session.cupom = cupom;
            await ctx.reply(
                `✅ *Cupom aplicado!*\n${cupom.desconto}% de desconto`,
                { parse_mode: 'Markdown' }
            );
        } else {
            await ctx.reply('❌ *Cupom inválido!*', { parse_mode: 'Markdown' });
        }
        ctx.session.step = null;
        return;
    }
    
    // Admin: Adicionar com IA
    if (ctx.session?.step === 'awaiting_ia_product' && isAdmin(ctx)) {
        const nome = ctx.message.text.trim();
        
        await ctx.reply(`🤖 Gerando descrição para "${nome}"...`);
        const descricao = await gerarDescricaoComIA(nome);
        
        produtos.push({
            nome: nome,
            preco: 0,
            descricao: descricao || 'Produto de alta qualidade'
        });
        
        const idx = produtos.length - 1;
        await ctx.reply(
            `✅ *${nome} adicionado!*\n\n` +
            `📝 Descrição: ${descricao || 'Gerada manualmente'}\n\n` +
            `⚠️ Agora edite o preço:\n/preco ${idx} VALOR\n\n` +
            `Ex: /preco ${idx} 49.90`,
            { parse_mode: 'Markdown' }
        );
        ctx.session = {};
        return;
    }
    
    // Admin: Adicionar manual
    if (ctx.session?.step === 'awaiting_manual_product' && isAdmin(ctx)) {
        const lines = ctx.message.text.split('\n');
        
        if (lines.length < 2) {
            return ctx.reply('❌ Formato inválido! Use:\nNome\nPreço\nDescrição');
        }
        
        const nome = lines[0].trim();
        const preco = parseFloat(lines[1]);
        const descricao = lines[2] || '';
        
        if (isNaN(preco)) {
            return ctx.reply('❌ Preço inválido!');
        }
        
        produtos.push({ nome, preco, descricao });
        await ctx.reply(`✅ *${nome} adicionado!\n💰 Preço: $${preco}`, { parse_mode: 'Markdown' });
        ctx.session = {};
        return;
    }
    
    // Admin: Criar cupom
    if (ctx.session?.step === 'awaiting_coupon_create' && isAdmin(ctx)) {
        const [codigo, desconto] = ctx.message.text.split('|');
        
        if (!codigo || !desconto) {
            return ctx.reply('❌ Formato inválido! Use: CODIGO|DESCONTO');
        }
        
        cupons.push({
            codigo: codigo.toUpperCase(),
            desconto: parseFloat(desconto),
            tipo: 'percentual',
            ativo: true
        });
        
        await ctx.reply(`✅ Cupom *${codigo.toUpperCase()}* criado!\n💰 ${desconto}% de desconto`, { parse_mode: 'Markdown' });
        ctx.session = {};
        return;
    }
    
    // Admin: Editar preço
    if (ctx.message.text.startsWith('/preco') && isAdmin(ctx)) {
        const parts = ctx.message.text.split(' ');
        const idx = parseInt(parts[1]);
        const preco = parseFloat(parts[2]);
        
        if (!isNaN(idx) && !isNaN(preco) && produtos[idx]) {
            produtos[idx].preco = preco;
            await ctx.reply(`✅ Preço de *${produtos[idx].nome}* atualizado para $${preco}`, { parse_mode: 'Markdown' });
        } else {
            await ctx.reply('❌ Use: /preco ID VALOR\nEx: /preco 0 49.90');
        }
    }
});

// ============ SERVIDOR ============
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('🤖 ROCKET FLOW BOT - Rodando 24/7!'));
app.post('/webhook/xrocket', async (req, res) => {
    console.log('📥 Webhook recebido:', req.body);
    res.json({ ok: true });
});

app.listen(PORT, () => {
    console.log(`✅ Servidor rodando na porta ${PORT}`);
    bot.launch();
    console.log('🤖 ROCKET FLOW BOT iniciado!');
    console.log(`👑 Admin ID: ${ADMIN_ID}`);
    console.log(`🤖 IA Gemini: ${GEMINI_API_KEY ? 'ATIVA' : 'INATIVA'}`);
    console.log(`💳 xRocket: ${XROCKET_API ? 'CONFIGURADO' : 'NÃO CONFIGURADO'}`);
});￼Enter    await ctx.reply(msg, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ FINALIZAR', 'checkout')],
            [Markup.button.callback('🎫 CUPOM', 'apply_coupon')],
            [Markup.button.callback('🗑️ LIMPAR', 'clear_cart')],
            [Markup.button.callback('🔙 Voltar', 'back')]
        ])
    });
});

// ============ LIMPAR CARRINHO ============
bot.action('clear_cart', async (ctx) => {
    carrinho.delete(ctx.from.id);
    await ctx.answerCbQuery('🗑️ Carrinho limpo!');
    await ctx.reply('✅ *Carrinho esvaziado!*', { parse_mode: 'Markdown', ...mainMenu });
});

// ============ FINALIZAR COMPRA ============
bot.action('checkout', async (ctx) => {
    const cart = carrinho.get(ctx.from.id) || [];
    
    if (cart.length === 0) {
        return ctx.reply('❌ *Carrinho vazio!*', { parse_mode: 'Markdown' });
    }
    
    await ctx.reply('🔄 *Gerando pagamento...*', { parse_mode: 'Markdown' });
    
    const cupomAplicado = ctx.session?.cupom;
    const payment = await criarPagamento(cart, ctx.from.id, cupomAplicado);
    
    if (payment?.url) {
        await ctx.reply(
            `💳 *PAGAMENTO GERADO!*\n\n` +
            `🔗 *Link:* ${payment.url}\n\n` +
            `💰 *Total:* $${payment.total.toFixed(2)} USDT\n` +
            `⏰ *Válido por:* 1 hora`,
            { parse_mode: 'Markdown' }
        );
        carrinho.delete(ctx.from.id);
        delete ctx.session?.cupom;
    } else {
        await ctx.reply(
            '❌ *Erro ao gerar pagamento!*\n\n' +
            'Tente novamente mais tarde.',
            { parse_mode: 'Markdown' }
        );
    }
});

// ============ CUPONS ============
bot.action('coupons', async (ctx) => {
    const cuponsAtivos = cupons.filter(c => c.ativo);
    
    if (cuponsAtivos.length === 0) {
        return ctx.reply('🎫 *Nenhum cupom ativo.*', { parse_mode: 'Markdown' });
    }
    
    let msg = '🎫 *CUPONS DISPONÍVEIS:*\n\n';
    for (const c of cuponsAtivos) {
        msg += `*${c.codigo}* - ${c.desconto}% OFF\n━━━━━━━━━━\n`;
    }
    
    await ctx.reply(msg, { parse_mode: 'Markdown' });
});

bot.action('apply_coupon', async (ctx) => {
    ctx.session = { step: 'awaiting_coupon' };
    await ctx.reply('🎫 *Digite o código do cupom:*\n\nEx: `ROCKET10`', { parse_mode: 'Markdown' });
});

// ============ ADMIN ============
bot.action('admin', async (ctx) => {
    if (!isAdmin(ctx)) {
        return ctx.reply('❌ *Acesso negado!*', { parse_mode: 'Markdown' });
    }
    await ctx.reply('⚙️ *Painel Administrativo*', {
        parse_mode: 'Markdown',
        ...adminMenu
    });
});

// ============ ADMIN: ADD COM IA ============
bot.action('add_ia', async (ctx) => {
    if (!isAdmin(ctx)) return;
    
    ctx.session = { step: 'awaiting_ia_product' };
    await ctx.reply(
        '🤖 *ADICIONAR PRODUTO COM IA*\n\n' +
  'Envie o *NOME* do produto:',
        { parse_mode: 'Markdown' }
    );
});

// ============ ADMIN: ADD MANUAL ============
bot.action('add_manual', async (ctx) => {
    if (!isAdmin(ctx)) return;
    
    ctx.session = { step: 'awaiting_manual_product' };
    await ctx.reply(
        '📝 *ADICIONAR PRODUTO MANUAL*\n\n' +
        'Envie no formato:\n' +
        '`Nome`\n`Preço`\n`Descrição`\n\n' +
        'Exemplo:\n' +
        'Curso de Python\n' +
        '49.90\n' +
        'Curso completo',
        { parse_mode: 'Markdown' }
    );
});

// ============ ADMIN: LISTAR ============
bot.action('list', async (ctx) => {
    if (!isAdmin(ctx)) return;
    
    if (produtos.length === 0) {
        return ctx.reply('📋 *Nenhum produto cadastrado.*', { parse_mode: 'Markdown' });
    }
    
    let msg = '*📋 PRODUTOS CADASTRADOS:*\n\n';
    produtos.forEach((p, i) => {
        msg += `${i + 1}. *${p.nome}*\n`;
        msg += `   💰 $${p.preco}\n`;
        msg += `   📝 ${p.descricao?.substring(0, 50)}...\n\n`;
    });
    
    await ctx.reply(msg, { parse_mode: 'Markdown' });
});

// ============ ADMIN: CRIAR CUPOM ============
bot.action('create_coupon', async (ctx) => {
    if (!isAdmin(ctx)) return;
    
    ctx.session = { step: 'awaiting_coupon_create' };
    await ctx.reply(
        '🎫 *CRIAR CUPOM*\n\n' +
        'Envie: `CODIGO|DESCONTO`\n\n' +
        'Exemplo: `BLACK20|20`',
        { parse_mode: 'Markdown' }
    );
});

// ============ VOLTAR ============
bot.action('back', async (ctx) => {
    await ctx.reply('🏠 *Menu Principal*', {
        parse_mode: 'Markdown',
        ...mainMenu
    });
});

// ============ PROCESSAR TEXTOS ============
bot.on('text', async (ctx) => {
    // Aplicar cupom no carrinho
    if (ctx.session?.step === 'awaiting_coupon') {
        const codigo = ctx.message.text.toUpperCase();
        const cupom = cupons.find(c => c.codigo === codigo && c.ativo);
        
        if (cupom) {
            ctx.session.cupom = cupom;
            await ctx.reply(
                `✅ *Cupom aplicado!*\n${cupom.desconto}% de desconto`,
                { parse_mode: 'Markdown' }
            );
        } else {
            await ctx.reply('❌ *Cupom inválido!*', { parse_mode: 'Markdown' });
        }
        ctx.session.step = null;
        return;
    }
    
    // Admin: Adicionar com IA
    if (ctx.session?.step === 'awaiting_ia_product' && isAdmin(ctx)) {
        const nome = ctx.message.text.trim();
        
        await ctx.reply(`🤖 Gerando descrição para "${nome}"...`);
        const descricao = await gerarDescricaoComIA(nome);
        
        produtos.push({
