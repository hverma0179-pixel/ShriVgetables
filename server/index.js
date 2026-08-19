import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { seedProducts } from './seed.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 10000;
const secret = process.env.JWT_SECRET || 'local-development-secret-change-me';
const dataDir = path.join(__dirname, '../data');
const dbFile = path.join(dataDir, 'store.json');
fs.mkdirSync(dataDir, { recursive: true });
const read = () => {
  const data = fs.existsSync(dbFile) ? JSON.parse(fs.readFileSync(dbFile, 'utf8')) : { products: seedProducts(), orders: [] };
  // One-time migration: replace the old emoji/remote-image catalogue with the
  // new local-photo Shri Ram vegetable catalogue. Existing customer orders stay.
  if (data.catalogueVersion !== 3 || !Array.isArray(data.products) || data.products.length !== 40 || data.products.some(product => !product.imageUrl || !product.hindiName)) {
    data.products = seedProducts();
    data.catalogueVersion = 3;
  }
  fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
  return data;
};
const write = (data) => fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
async function notifyOwner(order) {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const recipients = (process.env.WHATSAPP_RECIPIENT_PHONE || '').split(',').map(x => x.trim()).filter(Boolean);
  const messageText = [
    '*New Shri Vegetables order*',
    `Order: ${order.id}`,
    `Name: ${order.customer.name}`,
    `Phone: ${order.customer.phone}`,
    `Address: ${order.customer.address}`,
    `Items: ${order.items.map(item=>`${item.name} x${item.quantity}`).join(', ')}`,
    `Total: ₹${order.total}`
  ].join('\n');
  if (!recipients.length) return { sent:false, status:'not-configured', reason:'No owner WhatsApp number is configured' };
  if (!phoneId || !token) return { sent:false, status:'ready-to-send', whatsappUrl:`https://wa.me/${recipients[0]}?text=${encodeURIComponent(messageText)}`, recipient:recipients[0] };
  const version = process.env.WHATSAPP_GRAPH_VERSION || 'v22.0';
  const template = process.env.WHATSAPP_TEMPLATE_NAME || 'order_alert';
  const language = process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en_US';
  const message = { messaging_product:'whatsapp', type:'template', template:{name:template,language:{code:language},components:[{type:'body',parameters:[
    {type:'text',text:order.id},{type:'text',text:order.customer.name},{type:'text',text:order.customer.phone},{type:'text',text:order.customer.address},{type:'text',text:`₹${order.total}`}
  ]}]}};
  const results = await Promise.allSettled(recipients.map(async to => {
    const response = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({...message,to})});
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }));
  const failures = results.filter(r => r.status === 'rejected');
  if (failures.length) console.error('WhatsApp order alert failed:', failures.map(r=>r.reason.message).join(' | '));
  return { sent:failures.length === 0, status:failures.length ? 'failed' : 'sent', recipients:recipients.length };
}
const admin = (req,res,next) => { try { req.user = jwt.verify((req.headers.authorization || '').replace('Bearer ',''), secret); next(); } catch { res.status(401).json({message:'Please sign in as admin.'}); } };
app.use(cors()); app.use(express.json()); app.use(morgan('tiny'));
app.get('/api/products', (req,res) => { const {q='', category=''} = req.query; const products=read().products.filter(p => (!category || p.category===category) && `${p.name} ${p.category}`.toLowerCase().includes(q.toLowerCase())); res.json(products); });
app.get('/api/categories', (_,res) => res.json([...new Set(read().products.map(p=>p.category))]));
app.post('/api/admin/login', (req,res) => { const {email,password}=req.body; if (email === (process.env.ADMIN_EMAIL||'admin@shrivegetables.in') && password === (process.env.ADMIN_PASSWORD||'ChangeMe123!')) return res.json({token:jwt.sign({role:'admin',email},secret,{expiresIn:'8h'})}); res.status(401).json({message:'Incorrect email or password.'}); });
const cleanProduct = (input, existing = {}) => ({
  ...existing,
  hindiName: String(input.hindiName ?? existing.hindiName ?? '').trim(),
  name: String(input.name ?? existing.name ?? '').trim(),
  category: String(input.category ?? existing.category ?? 'Fruit vegetables').trim(),
  description: String(input.description ?? existing.description ?? '').trim(),
  imageUrl: String(input.imageUrl ?? existing.imageUrl ?? '/products/tomato.jpg').trim(),
  price: Number(input.price ?? existing.price ?? 0),
  stock: Math.max(0, Number(input.stock ?? existing.stock ?? 0)),
  unit: String(input.unit ?? existing.unit ?? 'kg').trim()
});
const validProduct = product => product.name && product.hindiName && product.imageUrl && Number.isFinite(product.price) && Number.isFinite(product.stock);
app.post('/api/products',admin,(req,res)=>{ const db=read(); const product={id:Date.now(),...cleanProduct(req.body),featured:false}; if(!validProduct(product)) return res.status(400).json({message:'Name, Hindi name, image URL, price and stock are required.'}); db.products.unshift(product); write(db); res.status(201).json(product); });
app.put('/api/products/:id',admin,(req,res)=>{const db=read(); const i=db.products.findIndex(p=>p.id==req.params.id); if(i<0)return res.sendStatus(404); const product=cleanProduct(req.body,db.products[i]); if(!validProduct(product)) return res.status(400).json({message:'Name, Hindi name, image URL, price and stock are required.'}); db.products[i]=product; write(db);res.json(product);});
app.delete('/api/products/:id',admin,(req,res)=>{const db=read();db.products=db.products.filter(p=>p.id!=req.params.id);write(db);res.sendStatus(204);});
app.post('/api/orders',async(req,res)=>{const {customer,items}=req.body; if(!customer?.name||!customer?.phone||!customer?.address||!items?.length)return res.status(400).json({message:'Please complete your delivery details.'}); const db=read(); for(const item of items){const p=db.products.find(x=>x.id===item.id);if(!p||p.stock<item.quantity)return res.status(400).json({message:`${item.name} is no longer available in that quantity.`});p.stock-=item.quantity;}const order={id:`SV${Date.now().toString().slice(-7)}`,customer,items,total:items.reduce((s,x)=>s+x.price*x.quantity,0),status:'Confirmed',createdAt:new Date().toISOString(),adminRead:false,adminReadAt:null,notification:{sent:false,status:'pending'}};db.orders.unshift(order);write(db);try{order.notification={...(await notifyOwner(order)),status:'processed'}}catch(error){console.error('WhatsApp order alert failed:',error.message);order.notification={sent:false,status:'failed'}}write(db);res.status(201).json(order);});
app.get('/api/orders',admin,(_,res)=>res.json(read().orders));
app.patch('/api/orders/:id/read',admin,(req,res)=>{const db=read();const order=db.orders.find(item=>item.id===req.params.id);if(!order)return res.sendStatus(404);order.adminRead=true;order.adminReadAt=new Date().toISOString();write(db);res.json(order);});
app.use(express.static(path.join(__dirname,'../dist'))); app.get('*',(_,res)=>res.sendFile(path.join(__dirname,'../dist/index.html')));
app.listen(PORT,()=>console.log(`Shri Vegetables listening on ${PORT}`));
