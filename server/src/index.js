import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { seedProducts } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 5000;
const secret = process.env.JWT_SECRET || 'local-development-secret-change-me';
const dataDir = path.join(__dirname, '../data');
const dbFile = path.join(dataDir, 'store.json');
fs.mkdirSync(dataDir, { recursive: true });
const read = () => { if (!fs.existsSync(dbFile)) { const d = { products: seedProducts(), orders: [] }; fs.writeFileSync(dbFile, JSON.stringify(d, null, 2)); return d; } return JSON.parse(fs.readFileSync(dbFile, 'utf8')); };
const write = (data) => fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
async function notifyOwner(order) {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const recipients = (process.env.WHATSAPP_RECIPIENT_PHONE || '').split(',').map(x => x.trim()).filter(Boolean);
  if (!phoneId || !token || !recipients.length) return { sent:false, reason:'WhatsApp is not configured' };
  const version = process.env.WHATSAPP_GRAPH_VERSION || 'v22.0';
  const template = process.env.WHATSAPP_TEMPLATE_NAME || 'order_alert';
  const language = process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en_US';
  const message = { messaging_product:'whatsapp', type:'template', template:{name:template,language:{code:language},components:[{type:'body',parameters:[{type:'text',text:order.id},{type:'text',text:order.customer.name},{type:'text',text:order.customer.phone},{type:'text',text:`₹${order.total}`}]}]}};
  const results = await Promise.allSettled(recipients.map(async to => {
    const response = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({...message,to})});
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }));
  const failures = results.filter(r => r.status === 'rejected');
  if (failures.length) console.error('WhatsApp order alert failed:', failures.map(r=>r.reason.message).join(' | '));
  return { sent:failures.length === 0, recipients:recipients.length };
}
const admin = (req,res,next) => { try { req.user = jwt.verify((req.headers.authorization || '').replace('Bearer ',''), secret); next(); } catch { res.status(401).json({message:'Please sign in as admin.'}); } };
app.use(cors()); app.use(express.json()); app.use(morgan('tiny'));
app.get('/api/products', (req,res) => { const {q='', category=''} = req.query; const products=read().products.filter(p => (!category || p.category===category) && `${p.name} ${p.category}`.toLowerCase().includes(q.toLowerCase())); res.json(products); });
app.get('/api/categories', (_,res) => res.json([...new Set(read().products.map(p=>p.category))]));
app.post('/api/admin/login', (req,res) => { const {email,password}=req.body; if (email === (process.env.ADMIN_EMAIL||'admin@shrivegetables.in') && password === (process.env.ADMIN_PASSWORD||'ChangeMe123!')) return res.json({token:jwt.sign({role:'admin',email},secret,{expiresIn:'8h'})}); res.status(401).json({message:'Incorrect email or password.'}); });
app.post('/api/products',admin,(req,res)=>{ const db=read(); const product={id:Date.now(),...req.body,price:Number(req.body.price),stock:Number(req.body.stock),image:req.body.image||'🥬'}; db.products.unshift(product); write(db); res.status(201).json(product); });
app.put('/api/products/:id',admin,(req,res)=>{const db=read(); const i=db.products.findIndex(p=>p.id==req.params.id); if(i<0)return res.sendStatus(404); db.products[i]={...db.products[i],...req.body,price:Number(req.body.price),stock:Number(req.body.stock)}; write(db);res.json(db.products[i]);});
app.delete('/api/products/:id',admin,(req,res)=>{const db=read();db.products=db.products.filter(p=>p.id!=req.params.id);write(db);res.sendStatus(204);});
app.post('/api/orders',async(req,res)=>{const {customer,items}=req.body; if(!customer?.name||!customer?.phone||!customer?.address||!items?.length)return res.status(400).json({message:'Please complete your delivery details.'}); const db=read(); for(const item of items){const p=db.products.find(x=>x.id===item.id);if(!p||p.stock<item.quantity)return res.status(400).json({message:`${item.name} is no longer available in that quantity.`});p.stock-=item.quantity;}const order={id:`SV${Date.now().toString().slice(-7)}`,customer,items,total:items.reduce((s,x)=>s+x.price*x.quantity,0),status:'Confirmed',createdAt:new Date().toISOString()};db.orders.unshift(order);write(db);let notification={sent:false};try{notification=await notifyOwner(order)}catch(error){console.error('WhatsApp order alert failed:',error.message)}res.status(201).json({...order,notification});});
app.get('/api/orders',admin,(_,res)=>res.json(read().orders));
app.use(express.static(path.join(__dirname,'../dist'))); app.get('*',(_,res)=>res.sendFile(path.join(__dirname,'../dist/index.html')));
app.listen(PORT, '0.0.0.0', ()=>console.log(`Shri Vegetables listening on ${PORT}`));
