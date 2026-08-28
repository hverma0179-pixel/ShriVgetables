import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import pg from 'pg';
import webpush from 'web-push';
import { fileURLToPath } from 'url';
import { seedProducts } from './seed.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 10000;
const secret = process.env.JWT_SECRET || 'local-development-secret-change-me';
const dataDir = process.env.DATA_DIR || path.join(__dirname, '../data');
const dbFile = path.join(dataDir, 'store.json');
const { Pool } = pg;
const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
}) : null;
let databaseReady;

fs.mkdirSync(dataDir, { recursive: true });

const freshStore = () => ({ products: seedProducts(), orders: [], pushSubscriptions: [], referrals: [], couponRedemptions: [], catalogueVersion: 10 });
const migrate = data => {
  const store = data && typeof data === 'object' ? data : freshStore();
  if (store.catalogueVersion !== 10 || !Array.isArray(store.products) || store.products.length !== 15 || store.products.some(product => !product.imageUrl || !product.hindiName || !product.imageUrl.endsWith('.webp'))) {
    store.products = seedProducts();
    store.catalogueVersion = 10;
  }
  if (!Array.isArray(store.orders)) store.orders = [];
  if (!Array.isArray(store.pushSubscriptions)) store.pushSubscriptions = [];
  if (!Array.isArray(store.referrals)) store.referrals = [];
  if (!Array.isArray(store.couponRedemptions)) store.couponRedemptions = [];
  return store;
};

async function ensureDatabase() {
  if (!pool) return;
  databaseReady ||= pool.query(`CREATE TABLE IF NOT EXISTS app_state (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await databaseReady;
}

async function read() {
  if (pool) {
    await ensureDatabase();
    const result = await pool.query('SELECT data FROM app_state WHERE id = $1', ['store']);
    const data = migrate(result.rows[0]?.data || freshStore());
    if (!result.rows.length || data.catalogueVersion !== result.rows[0]?.data?.catalogueVersion) await write(data);
    return data;
  }
  const raw = fs.existsSync(dbFile) ? JSON.parse(fs.readFileSync(dbFile, 'utf8')) : freshStore();
  const data = migrate(raw);
  fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
  return data;
}

async function write(data) {
  if (pool) {
    await ensureDatabase();
    await pool.query(
      `INSERT INTO app_state (id, data, updated_at) VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      ['store', JSON.stringify(data)]
    );
    return;
  }
  fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
}

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || '';
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || '';
const pushConfigured = Boolean(vapidPublicKey && vapidPrivateKey);
if (pushConfigured) {
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@shrivegetables.in', vapidPublicKey, vapidPrivateKey);
}

async function sendAdminPush(order, db) {
  if (!pushConfigured || !db.pushSubscriptions.length) return { sent: false, status: 'not-configured-or-subscribed' };
  const payload = JSON.stringify({
    title: `New order ${order.id}`,
    body: `${order.customer.name} · ${order.items.map(item => `${item.name} × ${item.quantity}`).join(', ')} · ₹${order.total}`,
    data: { url: '/?page=admin', orderId: order.id }
  });
  const results = await Promise.allSettled(db.pushSubscriptions.map(subscription => webpush.sendNotification(subscription, payload)));
  const expired = new Set();
  results.forEach((result, index) => {
    if (result.status === 'rejected' && [404, 410].includes(result.reason?.statusCode)) expired.add(db.pushSubscriptions[index].endpoint);
  });
  if (expired.size) db.pushSubscriptions = db.pushSubscriptions.filter(item => !expired.has(item.endpoint));
  const sent = results.filter(result => result.status === 'fulfilled').length;
  return { sent: sent > 0, status: sent ? 'sent' : 'failed', recipients: sent };
}

async function notifyOwner(order) {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const recipients = (process.env.WHATSAPP_RECIPIENT_PHONE || '').split(',').map(value => value.trim()).filter(Boolean);
  const messageText = [
    '*New Shri Vegetables order*',
    `Order: ${order.id}`,
    `Name: ${order.customer.name}`,
    `Phone: ${order.customer.phone}`,
    `Address: ${order.customer.address}`,
    `Delivery: ${order.customer.deliverySlot || 'As soon as possible'}`,
    `Items: ${order.items.map(item => `${item.name} x${item.quantity}`).join(', ')}`,
    `Total: ₹${order.total}`
  ].join('\n');
  if (!recipients.length) return { sent: false, status: 'not-configured' };
  if (!phoneId || !token) return { sent: false, status: 'ready-to-send', whatsappUrl: `https://wa.me/${recipients[0]}?text=${encodeURIComponent(messageText)}` };
  const version = process.env.WHATSAPP_GRAPH_VERSION || 'v22.0';
  const template = process.env.WHATSAPP_TEMPLATE_NAME || 'order_alert';
  const language = process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en_US';
  const message = { messaging_product: 'whatsapp', type: 'template', template: { name: template, language: { code: language }, components: [{ type: 'body', parameters: [
    { type: 'text', text: order.id }, { type: 'text', text: order.customer.name }, { type: 'text', text: order.customer.phone },
    { type: 'text', text: order.customer.address }, { type: 'text', text: `₹${order.total}` }
  ] }] } };
  const results = await Promise.allSettled(recipients.map(async to => {
    const response = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...message, to })
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }));
  const sent = results.filter(result => result.status === 'fulfilled').length;
  return { sent: sent > 0, status: sent ? 'sent' : 'failed', recipients: sent };
}

const admin = (req, res, next) => {
  try {
    req.user = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), secret);
    next();
  } catch {
    res.status(401).json({ message: 'Please sign in as admin.' });
  }
};

const requestBuckets = new Map();
const rateLimit = (name, max, windowMs) => (req, res, next) => {
  const now = Date.now();
  const key = `${name}:${req.ip}`;
  const bucket = requestBuckets.get(key);
  if (!bucket || now - bucket.started > windowMs) {
    requestBuckets.set(key, { started: now, count: 1 });
    return next();
  }
  if (bucket.count >= max) return res.status(429).json({ message: 'Please wait a moment and try again.' });
  bucket.count += 1;
  next();
};


const normalizePhone = value => String(value || '').replace(/\D/g, '').slice(-10);
const normalizePromoCode = value => String(value || '').trim().toUpperCase().replace(/\s+/g, '');
const referralRewardAmounts = [25, 50, 75];
const orderStatuses = ['Confirmed', 'Packing', 'Out for delivery', 'Delivered'];
const minimumOrderAmount = 100;
const standardDeliveryFee = 20;
const promotionError = message => Object.assign(new Error(message), { status: 400 });

const referralView = referral => ({
  code: referral.code,
  ownerName: referral.ownerName,
  referralCount: referral.referredPhones.length,
  rewards: referral.rewards.map(reward => ({ id: reward.id, amount: reward.amount, unlocked: Boolean(reward.unlockedAt), used: Boolean(reward.usedAt) }))
});

const basketFrom = (db, inputs) => {
  if (!Array.isArray(inputs) || !inputs.length) throw promotionError('Your basket is empty.');
  const items = inputs.map(input => {
    const product = db.products.find(item => item.id === Number(input.id));
    const quantity = Math.max(1, Math.min(20, Math.round(Number(input.quantity) || 0)));
    if (!product || product.stock < quantity) throw promotionError((input.name || 'An item') + ' is no longer available in that quantity.');
    return { product, quantity };
  });
  return { items, subtotal: items.reduce((sum, item) => sum + item.product.price * item.quantity, 0) };
};

const discountQuote = (db, { phone, couponCode, rewardId }, subtotal) => {
  const accountPhone = normalizePhone(phone);
  const code = normalizePromoCode(couponCode);
  const promotions = [];
  let discount = 0;

  if (code) {
    if (code !== 'SHRI50') throw promotionError('This coupon code is not valid.');
    if (accountPhone.length !== 10) throw promotionError('Enter a valid phone number before applying the coupon.');
    const uses = db.couponRedemptions.filter(item => item.code === 'SHRI50');
    if (uses.length >= 1000) throw promotionError('SHRI50 has reached its 1,000-account limit.');
    if (uses.some(item => item.phone === accountPhone)) throw promotionError('SHRI50 has already been used by this account.');
    const amount = Math.min(50, subtotal);
    discount += amount;
    promotions.push({ type: 'coupon', code: 'SHRI50', amount });
  }

  if (rewardId) {
    if (accountPhone.length !== 10) throw promotionError('Enter your referral phone number before using a reward.');
    const referral = db.referrals.find(item => item.rewards.some(reward => reward.id === rewardId));
    const reward = referral?.rewards.find(item => item.id === rewardId);
    if (!referral || !reward || !reward.unlockedAt || reward.usedAt) throw promotionError('This referral reward is not available.');
    if (referral.ownerPhone !== accountPhone) throw promotionError('This reward belongs to a different phone account.');
    const amount = Math.min(reward.amount, Math.max(0, subtotal - discount));
    discount += amount;
    promotions.push({ type: 'referral', code: referral.code, rewardId: reward.id, amount });
  }

  const previousOrders = accountPhone.length === 10
    ? db.orders.filter(order => normalizePhone(order.customer?.phone) === accountPhone).length
    : 0;
  const deliveryFee = previousOrders === 0 ? 0 : standardDeliveryFee;
  return { subtotal, discount, deliveryFee, firstDeliveryFree: deliveryFee === 0, total: Math.max(0, subtotal - discount) + deliveryFee, promotions };
};

const customerOrderView = order => ({
  id: order.id,
  items: order.items,
  subtotal: order.subtotal,
  discount: order.discount || 0,
  deliveryFee: order.deliveryFee || 0,
  total: order.total,
  status: order.status,
  statusHistory: order.statusHistory || [{ status: order.status || 'Confirmed', at: order.createdAt }],
  deliverySlot: order.customer?.deliverySlot,
  createdAt: order.createdAt
});

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.use(morgan('tiny'));

app.get('/api/health', (_, res) => res.json({ ok: true, storage: pool ? 'postgres' : 'json', ai: Boolean(process.env.GEMINI_API_KEY), push: pushConfigured }));
app.get('/api/products', async (req, res, next) => {
  try {
    const { q = '', category = '' } = req.query;
    const products = (await read()).products.filter(product => (!category || product.category === category) && `${product.name} ${product.hindiName} ${product.category}`.toLowerCase().includes(String(q).toLowerCase()));
    res.json(products);
  } catch (error) { next(error); }
});
app.get('/api/categories', async (_, res, next) => {
  try { res.json([...new Set((await read()).products.map(product => product.category))]); } catch (error) { next(error); }
});

app.post('/api/admin/login', rateLimit('login', 8, 15 * 60 * 1000), (req, res) => {
  const email = process.env.ADMIN_EMAIL || 'admin@shrivegetables.in';
  const password = process.env.ADMIN_PASSWORD || (process.env.NODE_ENV === 'production' ? '' : 'ChangeMe123!');
  if (!password) return res.status(503).json({ message: 'Admin password is not configured.' });
  if (req.body.email === email && req.body.password === password) return res.json({ token: jwt.sign({ role: 'admin', email }, secret, { expiresIn: '8h' }) });
  res.status(401).json({ message: 'Incorrect email or password.' });
});

const cleanProduct = (input, existing = {}) => ({
  ...existing,
  hindiName: String(input.hindiName ?? existing.hindiName ?? '').trim(),
  name: String(input.name ?? existing.name ?? '').trim(),
  category: String(input.category ?? existing.category ?? 'Fruit vegetables').trim(),
  description: String(input.description ?? existing.description ?? '').trim(),
  imageUrl: String(input.imageUrl ?? existing.imageUrl ?? '/products/vegetables/tomato.webp').trim(),
  price: Number(input.price ?? existing.price ?? 0),
  stock: Math.max(0, Number(input.stock ?? existing.stock ?? 0)),
  unit: String(input.unit ?? existing.unit ?? 'kg').trim()
});
const validProduct = product => product.name && product.hindiName && product.imageUrl && Number.isFinite(product.price) && Number.isFinite(product.stock);
app.post('/api/products', admin, async (req, res, next) => {
  try { const db = await read(); const product = { id: Date.now(), ...cleanProduct(req.body), featured: false }; if (!validProduct(product)) return res.status(400).json({ message: 'Name, Hindi name, image URL, price and stock are required.' }); db.products.unshift(product); await write(db); res.status(201).json(product); } catch (error) { next(error); }
});
app.put('/api/products/:id', admin, async (req, res, next) => {
  try { const db = await read(); const index = db.products.findIndex(product => product.id == req.params.id); if (index < 0) return res.sendStatus(404); const product = cleanProduct(req.body, db.products[index]); if (!validProduct(product)) return res.status(400).json({ message: 'Complete all required product fields.' }); db.products[index] = product; await write(db); res.json(product); } catch (error) { next(error); }
});
app.delete('/api/products/:id', admin, async (req, res, next) => {
  try { const db = await read(); db.products = db.products.filter(product => product.id != req.params.id); await write(db); res.sendStatus(204); } catch (error) { next(error); }
});

app.post('/api/ai/recommendations', rateLimit('ai', 12, 10 * 60 * 1000), async (req, res, next) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(503).json({ message: 'AI assistant is waiting for GEMINI_API_KEY in Render.' });
    const request = String(req.body.request || '').trim().slice(0, 600);
    if (request.length < 3) return res.status(400).json({ message: 'Tell the assistant what you need.' });
    const db = await read();
    const available = db.products.filter(product => product.stock > 0).map(({ id, name, hindiName, category, price, stock, unit, description }) => ({ id, name, hindiName, category, price, stock, unit, description }));
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: 'You are a careful grocery assistant for Shri Vegetables. Recommend only product IDs present in the supplied catalogue. Respect budget, family size, dietary preferences and requested meals. Never claim an order has been placed. Keep quantities practical.' }] },
        contents: [{ role: 'user', parts: [{ text: `Customer request: ${request}\n\nLive catalogue:\n${JSON.stringify(available)}` }] }],
        generationConfig: {
          temperature: 0.25,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'object',
            properties: {
              summary: { type: 'string' },
              items: { type: 'array', items: { type: 'object', properties: { productId: { type: 'integer' }, quantity: { type: 'integer' }, reason: { type: 'string' } }, required: ['productId', 'quantity', 'reason'] } },
              tips: { type: 'array', items: { type: 'string' } }
            },
            required: ['summary', 'items', 'tips']
          }
        }
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message || 'Gemini request failed.');
    const text = payload.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '';
    const plan = JSON.parse(text.replace(/^```json\s*|```$/g, '').trim());
    const combined = new Map();
    for (const suggestion of Array.isArray(plan.items) ? plan.items : []) {
      const product = db.products.find(item => item.id === Number(suggestion.productId) && item.stock > 0);
      if (!product) continue;
      const quantity = Math.max(1, Math.min(product.stock, 10, Math.round(Number(suggestion.quantity) || 1)));
      const current = combined.get(product.id);
      combined.set(product.id, { product, quantity: Math.min(product.stock, 10, (current?.quantity || 0) + quantity), reason: String(suggestion.reason || '').slice(0, 180) });
    }
    const items = [...combined.values()].map(({ product, quantity, reason }) => ({ ...product, quantity, reason, lineTotal: product.price * quantity }));
    if (!items.length) return res.status(422).json({ message: 'The assistant could not make a safe list from the current stock. Try a clearer request.' });
    res.json({ summary: String(plan.summary || 'A practical fresh basket for you.'), tips: Array.isArray(plan.tips) ? plan.tips.slice(0, 4).map(String) : [], items, total: items.reduce((sum, item) => sum + item.lineTotal, 0), model });
  } catch (error) { next(error); }
});


app.post('/api/referrals', rateLimit('referrals', 20, 60 * 60 * 1000), async (req, res, next) => {
  try {
    const ownerPhone = normalizePhone(req.body.phone);
    const ownerName = String(req.body.name || '').trim().slice(0, 80);
    if (ownerPhone.length !== 10 || !ownerName) throw promotionError('Enter your name and a valid phone number to create a referral.');
    const db = await read();
    let referral = db.referrals.find(item => item.ownerPhone === ownerPhone);
    if (!referral) {
      let code;
      do { code = 'SHRI-' + crypto.randomBytes(3).toString('hex').toUpperCase(); } while (db.referrals.some(item => item.code === code));
      referral = {
        code, ownerName, ownerPhone, createdAt: new Date().toISOString(), referredPhones: [],
        rewards: referralRewardAmounts.map((amount, index) => ({ id: code + '-R' + (index + 1), amount, unlockedAt: null, usedAt: null, orderId: null }))
      };
      db.referrals.push(referral);
      await write(db);
    }
    res.status(201).json({ ...referralView(referral), link: req.protocol + '://' + req.get('host') + '/?ref=' + encodeURIComponent(referral.code) });
  } catch (error) { next(error); }
});

app.post('/api/referrals/validate', rateLimit('referral-validate', 40, 60 * 60 * 1000), async (req, res, next) => {
  try {
    const code = normalizePromoCode(req.body.code).replace(/^SHRI(?!-)/, 'SHRI-');
    const referral = (await read()).referrals.find(item => item.code === code);
    if (!referral) throw promotionError('Referral code not found. Check the code and try again.');
    res.json({ valid: true, code: referral.code, message: 'Referral linked. The reward unlocks after your first confirmed order.' });
  } catch (error) { next(error); }
});

app.post('/api/referrals/status', rateLimit('referral-status', 40, 60 * 60 * 1000), async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const code = normalizePromoCode(req.body.code).replace(/^SHRI(?!-)/, 'SHRI-');
    const referral = (await read()).referrals.find(item => item.code === code && item.ownerPhone === phone);
    if (!referral) throw promotionError('Referral details do not match this phone account.');
    res.json({ ...referralView(referral), link: req.protocol + '://' + req.get('host') + '/?ref=' + encodeURIComponent(referral.code) });
  } catch (error) { next(error); }
});

app.post('/api/promotions/quote', rateLimit('promotion-quote', 50, 10 * 60 * 1000), async (req, res, next) => {
  try {
    const db = await read();
    const { subtotal } = basketFrom(db, req.body.items);
    res.json(discountQuote(db, req.body, subtotal));
  } catch (error) { next(error); }
});

app.get('/api/admin/promotions', admin, async (_, res, next) => {
  try {
    const db = await read();
    const uses = db.couponRedemptions.filter(item => item.code === 'SHRI50').length;
    res.json({
      coupon: { code: 'SHRI50', amount: 50, used: uses, limit: 1000, remaining: Math.max(0, 1000 - uses) },
      referrals: db.referrals.map(referral => ({ ...referralView(referral), ownerPhone: referral.ownerPhone, createdAt: referral.createdAt }))
    });
  } catch (error) { next(error); }
});

app.post('/api/orders', rateLimit('orders', 20, 10 * 60 * 1000), async (req, res, next) => {
  try {
    const { customer = {}, items = [], couponCode = '', referralCode = '', referralRewardId = '', weeklyBasket = {} } = req.body;
    const cleanCustomer = {
      name: String(customer.name || '').trim().slice(0, 80),
      phone: normalizePhone(customer.phone),
      address: String(customer.address || '').trim().slice(0, 300),
      deliverySlot: String(customer.deliverySlot || 'As soon as possible').slice(0, 80),
      paymentMethod: String(customer.paymentMethod || 'Cash on delivery').slice(0, 40),
      notes: String(customer.notes || '').trim().slice(0, 300)
    };
    if (!cleanCustomer.name || cleanCustomer.phone.length !== 10 || !cleanCustomer.address || !Array.isArray(items) || !items.length) {
      return res.status(400).json({ message: 'Please complete your name, valid phone number and delivery address.' });
    }

    const db = await read();
    const basket = basketFrom(db, items);
    if (basket.subtotal < minimumOrderAmount) throw promotionError(`Minimum order is ₹${minimumOrderAmount}. Add ₹${minimumOrderAmount - basket.subtotal} more to continue.`);
    const quote = discountQuote(db, { phone: cleanCustomer.phone, couponCode, rewardId: referralRewardId }, basket.subtotal);
    const incomingReferralCode = normalizePromoCode(referralCode).replace(/^SHRI(?!-)/, 'SHRI-');
    let referredBy = null;
    let unlockedReward = null;

    if (incomingReferralCode) {
      const referral = db.referrals.find(item => item.code === incomingReferralCode);
      if (!referral) throw promotionError('The linked referral code is no longer valid.');
      if (referral.ownerPhone === cleanCustomer.phone) throw promotionError('You cannot use your own referral link.');
      const alreadyCustomer = db.orders.some(order => normalizePhone(order.customer?.phone) === cleanCustomer.phone);
      const countedAnywhere = db.referrals.some(item => item.referredPhones.includes(cleanCustomer.phone));
      if (!alreadyCustomer && !countedAnywhere) {
        const rewardIndex = referral.referredPhones.length;
        referral.referredPhones.push(cleanCustomer.phone);
        if (rewardIndex < referral.rewards.length) {
          referral.rewards[rewardIndex].unlockedAt = new Date().toISOString();
          unlockedReward = { id: referral.rewards[rewardIndex].id, amount: referral.rewards[rewardIndex].amount };
        }
        referredBy = referral.code;
      }
    }

    const orderItems = basket.items.map(({ product, quantity }) => {
      product.stock -= quantity;
      return { id: product.id, name: product.name, hindiName: product.hindiName, price: product.price, unit: product.unit, imageUrl: product.imageUrl, quantity };
    });
    const orderId = 'SV' + Date.now().toString().slice(-7);

    for (const promotion of quote.promotions) {
      if (promotion.type === 'coupon') {
        db.couponRedemptions.push({ code: promotion.code, phone: cleanCustomer.phone, orderId, amount: promotion.amount, redeemedAt: new Date().toISOString() });
      }
      if (promotion.type === 'referral') {
        const referral = db.referrals.find(item => item.rewards.some(reward => reward.id === promotion.rewardId));
        const reward = referral?.rewards.find(item => item.id === promotion.rewardId);
        if (reward) { reward.usedAt = new Date().toISOString(); reward.orderId = orderId; }
      }
    }

    const order = {
      id: orderId,
      customer: cleanCustomer,
      items: orderItems,
      subtotal: quote.subtotal,
      discount: quote.discount,
      deliveryFee: quote.deliveryFee,
      total: quote.total,
      promotions: quote.promotions,
      referredBy,
      referralRewardUnlocked: unlockedReward,
      weeklyBasket: {
        enabled: Boolean(weeklyBasket.enabled),
        day: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].includes(weeklyBasket.day) ? weeklyBasket.day : 'Saturday'
      },
      status: 'Confirmed',
      statusHistory: [{ status: 'Confirmed', at: new Date().toISOString() }],
      createdAt: new Date().toISOString(),
      adminRead: false,
      adminReadAt: null,
      notification: { status: 'pending' }
    };
    db.orders.unshift(order);
    await write(db);

    const [whatsapp, push] = await Promise.all([
      notifyOwner(order).catch(error => ({ sent: false, status: 'failed', error: error.message })),
      sendAdminPush(order, db).catch(error => ({ sent: false, status: 'failed', error: error.message }))
    ]);
    order.notification = { whatsapp, push, status: 'processed' };
    await write(db);
    res.status(201).json(order);
  } catch (error) { next(error); }
});

app.get('/api/orders', admin, async (_, res, next) => { try { res.json((await read()).orders); } catch (error) { next(error); } });
app.post('/api/orders/track', rateLimit('order-track', 80, 10 * 60 * 1000), async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const orderId = String(req.body.orderId || '').trim().toUpperCase();
    if (phone.length !== 10 || !orderId) throw promotionError('Enter the order ID and the same phone number used at checkout.');
    const order = (await read()).orders.find(item => item.id === orderId && normalizePhone(item.customer?.phone) === phone);
    if (!order) throw promotionError('Order details did not match. Please check your order ID and phone number.');
    res.json(customerOrderView(order));
  } catch (error) { next(error); }
});
app.patch('/api/orders/:id/status', admin, async (req, res, next) => {
  try {
    const nextStatus = String(req.body.status || '').trim();
    if (!orderStatuses.includes(nextStatus)) throw promotionError('Choose a valid order status.');
    const db = await read();
    const order = db.orders.find(item => item.id === req.params.id);
    if (!order) return res.sendStatus(404);
    const currentIndex = Math.max(0, orderStatuses.indexOf(order.status));
    const nextIndex = orderStatuses.indexOf(nextStatus);
    if (nextIndex < currentIndex || nextIndex > currentIndex + 1) throw promotionError('Update the order one step at a time.');
    if (nextStatus !== order.status) {
      order.status = nextStatus;
      order.statusHistory ||= [{ status: 'Confirmed', at: order.createdAt }];
      order.statusHistory.push({ status: nextStatus, at: new Date().toISOString() });
    }
    order.adminRead = true;
    order.adminReadAt ||= new Date().toISOString();
    await write(db);
    res.json(order);
  } catch (error) { next(error); }
});
app.patch('/api/orders/:id/read', admin, async (req, res, next) => {
  try { const db = await read(); const order = db.orders.find(item => item.id === req.params.id); if (!order) return res.sendStatus(404); order.adminRead = true; order.adminReadAt = new Date().toISOString(); await write(db); res.json(order); } catch (error) { next(error); }
});
app.get('/api/push/config', (_, res) => res.json({ configured: pushConfigured, publicKey: pushConfigured ? vapidPublicKey : '' }));
app.post('/api/admin/push-subscriptions', admin, async (req, res, next) => {
  try { if (!pushConfigured) return res.status(503).json({ message: 'VAPID keys are not configured in Render.' }); const subscription = req.body; if (!subscription?.endpoint || !subscription?.keys) return res.status(400).json({ message: 'Invalid push subscription.' }); const db = await read(); db.pushSubscriptions = db.pushSubscriptions.filter(item => item.endpoint !== subscription.endpoint); db.pushSubscriptions.push(subscription); await write(db); res.status(201).json({ ok: true }); } catch (error) { next(error); }
});

app.use(express.static(path.join(__dirname, '../dist'), { maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0 }));
app.get('*', (_, res) => res.sendFile(path.join(__dirname, '../dist/index.html')));
app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  const status = Number(error.status) || 500;
  res.status(status).json({ message: status < 500 || process.env.NODE_ENV !== 'production' ? error.message : 'Something went wrong. Please try again.' });
});

await read();
app.listen(PORT, () => console.log(`Shri Vegetables listening on ${PORT} (${pool ? 'Postgres' : 'JSON'} storage)`));