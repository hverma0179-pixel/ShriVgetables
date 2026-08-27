import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const API = '/api';
const fallbackImage = '/products/vegetables/tomato.webp';
const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value || 0);
const readLocal = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (localStorage.getItem('shri_admin_token')) headers.Authorization = 'Bearer ' + localStorage.getItem('shri_admin_token');
  const response = await fetch(API + path, { ...options, headers });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || 'Something went wrong. Please try again.');
  return payload;
}

function ProductImage({ src, alt, eager = false, className = '' }) {
  const [image, setImage] = useState(src || fallbackImage);
  useEffect(() => setImage(src || fallbackImage), [src]);
  return <img className={className} src={image} alt={alt} loading={eager ? 'eager' : 'lazy'} decoding="async" onError={() => setImage(fallbackImage)} />;
}

function Icon({ name }) {
  const icons = {
    basket: 'M3 7h18l-2 13H5L3 7Zm4 0 3-5m7 5-3-5M8 11v5m4-5v5m4-5v5',
    sparkle: 'm12 2 1.6 5.4L19 9l-5.4 1.6L12 16l-1.6-5.4L5 9l5.4-1.6L12 2Zm7 13 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z',
    heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.7-7.5 1.1-1.1a5.5 5.5 0 0 0 0-7.8Z',
    arrow: 'M5 12h14m-6-6 6 6-6 6',
    bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Zm-8 13h4',
    close: 'M6 6l12 12M18 6 6 18',
    search: 'm21 21-4.4-4.4m2.4-5.1A7.5 7.5 0 1 1 4 11.5a7.5 7.5 0 0 1 15 0Z',
    check: 'm5 12 4 4L19 6',
    plus: 'M12 5v14M5 12h14',
    minus: 'M5 12h14',
    trash: 'M4 7h16m-10 4v6m4-6v6M9 7l1-3h4l1 3m-9 0 1 14h10l1-14'
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d={icons[name]} /></svg>;
}

function App() {
  const incomingReferral = new URLSearchParams(location.search).get('ref') || '';
  const getPage = () => new URLSearchParams(location.search).get('page') || 'shop';
  const [page, setPage] = useState(getPage);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState(() => readLocal('shri_cart', []));
  const [favorites, setFavorites] = useState(() => readLocal('shri_favorites', []));
  const [selected, setSelected] = useState(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [referralGate, setReferralGate] = useState(incomingReferral);
  const [toast, setToast] = useState('');

  const loadProducts = useCallback(async () => {
    try { setProducts(await api('/products')); }
    catch (error) { setToast(error.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadProducts(); }, [loadProducts]);
  useEffect(() => { localStorage.setItem('shri_cart', JSON.stringify(cart)); }, [cart]);
  useEffect(() => { localStorage.setItem('shri_favorites', JSON.stringify(favorites)); }, [favorites]);
  useEffect(() => {
    const handler = () => setPage(getPage());
    addEventListener('popstate', handler);
    return () => removeEventListener('popstate', handler);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  const navigate = next => {
    setPage(next);
    history.pushState({}, '', next === 'shop' ? '/' : '/?page=' + next);
    scrollTo({ top: 0, behavior: 'smooth' });
  };
  const addToCart = (product, quantity = 1) => {
    setCart(current => {
      const existing = current.find(item => item.id === product.id);
      const nextQuantity = Math.min(product.stock, (existing?.quantity || 0) + quantity);
      return existing ? current.map(item => item.id === product.id ? { ...product, quantity: nextQuantity } : item) : [...current, { ...product, quantity: Math.min(quantity, product.stock) }];
    });
    setToast(product.name + ' added to your basket');
  };
  const approveAiPlan = items => {
    setCart(current => {
      const next = [...current];
      items.forEach(item => {
        const index = next.findIndex(product => product.id === item.id);
        const quantity = Math.min(item.stock, (index >= 0 ? next[index].quantity : 0) + item.quantity);
        if (index >= 0) next[index] = { ...item, quantity };
        else next.push({ ...item, quantity });
      });
      return next;
    });
    setAiOpen(false);
    navigate('cart');
    setToast('AI list added. Please review and confirm your order.');
  };
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  return <>
    <Header page={page} navigate={navigate} cartCount={cartCount} openAi={() => setAiOpen(true)} />
    {page === 'admin'
      ? <Admin reloadStore={loadProducts} />
      : page === 'cart'
        ? <Cart cart={cart} setCart={setCart} navigate={navigate} reloadStore={loadProducts} />
        : <Shop products={products} loading={loading} addToCart={addToCart} favorites={favorites} setFavorites={setFavorites} select={setSelected} openAi={() => setAiOpen(true)} />}
    <footer><div className="footer-brand"><b>श्री</b><span>SHRI VEGETABLES</span></div><p>Fresh produce, clear prices, simple ordering.</p><button onClick={() => navigate('admin')}>Admin</button><small>© {new Date().getFullYear()} Shri Vegetables</small></footer>
    {selected && <Details product={selected} add={() => addToCart(selected)} close={() => setSelected(null)} />}
    {aiOpen && <AiAssistant close={() => setAiOpen(false)} approve={approveAiPlan} />}
    {referralGate && <ReferralGate initialCode={referralGate} close={() => { history.replaceState({}, '', '/'); setReferralGate(''); }} accepted={code => { localStorage.setItem('shri_pending_referral', code); history.replaceState({}, '', '/'); setPage('shop'); setReferralGate(''); setToast('Referral linked. Place your first order to unlock your friend’s reward.'); }} />}
    {toast && <div className="toast" role="status"><Icon name="check" />{toast}</div>}
  </>;
}

function Header({ page, navigate, cartCount, openAi }) {
  return <header>
    <button className="brand" onClick={() => navigate('shop')} aria-label="Shri Vegetables home"><span>श्री</span><i>VEGETABLES</i></button>
    <nav aria-label="Main navigation">
      <button className={page === 'shop' ? 'nav-active' : ''} onClick={() => navigate('shop')}>Shop</button>
      <button className="ai-nav" onClick={openAi}><Icon name="sparkle" /><span>AI helper</span></button>
      <button className="cart-nav" onClick={() => navigate('cart')}><Icon name="basket" /><span>Basket</span>{cartCount > 0 && <b>{cartCount}</b>}</button>
    </nav>
  </header>;
}

function Shop({ products, loading, addToCart, favorites, setFavorites, select, openAi }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [sort, setSort] = useState('featured');
  const [onlySaved, setOnlySaved] = useState(false);
  const categories = useMemo(() => ['All', ...new Set(products.map(product => product.category))], [products]);
  const shown = useMemo(() => {
    let list = products.filter(product =>
      (!query || (product.name + ' ' + product.hindiName + ' ' + product.description).toLowerCase().includes(query.toLowerCase())) &&
      (category === 'All' || product.category === category) &&
      (!onlySaved || favorites.includes(product.id))
    );
    if (sort === 'low') list = [...list].sort((a, b) => a.price - b.price);
    if (sort === 'high') list = [...list].sort((a, b) => b.price - a.price);
    if (sort === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'featured') list = [...list].sort((a, b) => Number(b.featured) - Number(a.featured));
    return list;
  }, [products, query, category, sort, onlySaved, favorites]);
  const toggleFavorite = product => setFavorites(current => current.includes(product.id) ? current.filter(id => id !== product.id) : [...current, product.id]);

  return <main>
    <section className="hero">
      <div className="hero-copy">
        <span className="eyebrow">FRESH FROM THE MARKET · रोज़ ताज़ा</span>
        <h1>Good food begins with <em>freshness.</em></h1>
        <p>Correctly matched produce, honest prices and an easier way to build your weekly basket.</p>
        <div className="hero-actions">
          <button className="primary" onClick={() => document.getElementById('catalogue')?.scrollIntoView({ behavior: 'smooth' })}>Shop fresh <Icon name="arrow" /></button>
          <button className="soft-button" onClick={openAi}><Icon name="sparkle" />Build my basket with AI</button>
        </div>
        <div className="hero-proof"><span><b>15</b> matched products</span><span><b>Fast</b> local ordering</span><span><b>₹</b> clear pricing</span></div>
      </div>
      <div className="hero-visual"><div className="sun-shape" /><ProductImage src="/products/vegetables/potato.webp" alt="Fresh potatoes" eager /><div className="floating-card floating-one"><b>100% name matched</b><span>Photo · title · details</span></div><div className="floating-card floating-two"><span className="live-dot" />Fresh stock today</div></div>
    </section>
    <section className="service-strip"><span>✓ Carefully matched photos</span><span>✓ Mobile-friendly ordering</span><span>✓ AI only when you ask</span><span>✓ Admin-confirmed orders</span></section>
    <section className="market" id="catalogue">
      <div className="section-heading"><div><span className="eyebrow">THE FRESH EDIT</span><h2>Pick what feels good today.</h2><p>{products.length} fresh products currently available.</p></div><div className="search-box"><Icon name="search" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search tomato, आलू…" /></div></div>
      <div className="catalogue-tools">
        <div className="chips">{categories.map(item => <button key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div>
        <div className="view-tools"><button className={onlySaved ? 'saved active' : 'saved'} onClick={() => setOnlySaved(value => !value)}><Icon name="heart" />Saved</button><select value={sort} onChange={event => setSort(event.target.value)}><option value="featured">Featured</option><option value="name">Name A–Z</option><option value="low">Price low to high</option><option value="high">Price high to low</option></select></div>
      </div>
      {loading ? <div className="grid">{Array.from({ length: 8 }, (_, index) => <div className="skeleton card" key={index}><div /><span /><span /></div>)}</div>
        : shown.length ? <div className="grid">{shown.map(product => <ProductCard key={product.id} product={product} add={() => addToCart(product)} details={() => select(product)} saved={favorites.includes(product.id)} toggleSaved={() => toggleFavorite(product)} />)}</div>
        : <div className="empty-state"><span>🥬</span><h3>No matching produce</h3><p>Try another search or category.</p><button className="soft-button" onClick={() => { setQuery(''); setCategory('All'); setOnlySaved(false); }}>Show everything</button></div>}
    </section>
    <section className="ai-banner"><div><span className="eyebrow">GEMINI-POWERED SHOPPING HELP</span><h2>Tell us the meals. Get the whole list.</h2><p>Ask for a weekly family basket, a sabzi plan, salad ingredients or a budget-friendly list. You review every item before ordering.</p></div><button className="light-button" onClick={openAi}><Icon name="sparkle" />Ask the AI helper</button></section>
  </main>;
}

function ProductCard({ product, add, details, saved, toggleSaved }) {
  return <article className="card"><div className="photo-wrap"><ProductImage src={product.imageUrl} alt={product.name} /><span className="category-tag">{product.category}</span><button className={'heart-button ' + (saved ? 'active' : '')} onClick={toggleSaved}><Icon name="heart" /></button></div>
    <div className="card-body"><div className="title-row"><div><h3>{product.name}</h3><span>{product.hindiName}</span></div><strong>{money(product.price)}<small>/{product.unit}</small></strong></div><p>{product.description}</p><div className="stock-row"><span className={product.stock > 0 ? 'in-stock' : 'out-stock'}>{product.stock > 0 ? '● In stock' : 'Out of stock'}</span><span>{product.stock} {product.unit}</span></div><div className="card-actions"><button className="details-button" onClick={details}>Details</button><button className="add-button" disabled={!product.stock} onClick={add}><Icon name="plus" />Add</button></div></div>
  </article>;
}

function Details({ product, add, close }) {
  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && close()}><article className="detail-modal" role="dialog" aria-modal="true"><button className="close-button" onClick={close}><Icon name="close" /></button><ProductImage src={product.imageUrl} alt={product.name} eager /><div className="detail-copy"><span className="eyebrow">{product.category}</span><h2>{product.name}</h2><h3>{product.hindiName}</h3><p>{product.description}</p><ul><li>Image and product name verified</li><li>Fresh stock: {product.stock} {product.unit}</li><li>Suitable for everyday home cooking</li></ul><div className="detail-buy"><strong>{money(product.price)} <small>/ {product.unit}</small></strong><button className="primary" onClick={() => { add(); close(); }}>Add to basket <Icon name="arrow" /></button></div></div></article></div>;
}
function AiAssistant({ close, approve }) {
  const [request, setRequest] = useState('');
  const [plan, setPlan] = useState(null);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState('');
  const quick = ['Weekly vegetables for a family of 4 under ₹700', 'Healthy salad basket for 3 days', 'Vegetables for simple Indian dinners this week'];
  const ask = async event => {
    event?.preventDefault();
    if (!request.trim() || thinking) return;
    setThinking(true); setError(''); setPlan(null);
    try { setPlan(await api('/ai/recommendations', { method: 'POST', body: JSON.stringify({ request }) })); }
    catch (reason) { setError(reason.message); }
    finally { setThinking(false); }
  };

  return <div className="ai-shell" role="dialog" aria-modal="true" aria-label="AI shopping helper"><div className="ai-panel">
    <div className="ai-head"><div className="ai-orb"><Icon name="sparkle" /></div><div><span>SHRI AI HELPER</span><h2>Let’s build your fresh list.</h2></div><button className="close-button" onClick={close}><Icon name="close" /></button></div>
    {!plan ? <>
      <p className="ai-intro">Describe your family size, meals, preferences and budget. The assistant recommends only products currently in stock.</p>
      <div className="quick-prompts">{quick.map(prompt => <button key={prompt} onClick={() => setRequest(prompt)}>{prompt}</button>)}</div>
      <form className="ai-form" onSubmit={ask}><textarea autoFocus value={request} onChange={event => setRequest(event.target.value)} placeholder="Example: Make a 5-day vegetable list for two people, mostly Indian meals, under ₹500…" maxLength="600" /><div><small>{request.length}/600</small><button className="primary" disabled={thinking || request.trim().length < 3}>{thinking ? <><span className="spinner" />Making your list…</> : <>Create my list <Icon name="sparkle" /></>}</button></div></form>
      {error && <div className="notice error-notice">{error}</div>}
      <small className="privacy-note">AI runs only after you tap “Create my list”. It cannot place an order without your approval.</small>
    </> : <div className="ai-result">
      <div className="plan-summary"><span className="eyebrow">YOUR SUGGESTED BASKET</span><h3>{plan.summary}</h3></div>
      <div className="plan-items">{plan.items.map(item => <article key={item.id}><ProductImage src={item.imageUrl} alt={item.name} /><div><b>{item.name} · {item.hindiName}</b><span>{item.quantity} {item.unit} · {money(item.lineTotal)}</span><small>{item.reason}</small></div></article>)}</div>
      {plan.tips?.length > 0 && <div className="plan-tips"><b>Useful notes</b>{plan.tips.map(tip => <span key={tip}>• {tip}</span>)}</div>}
      <div className="plan-total"><span>Verified catalogue total</span><strong>{money(plan.total)}</strong></div>
      <div className="ai-result-actions"><button className="details-button" onClick={() => setPlan(null)}>Change request</button><button className="primary" onClick={() => approve(plan.items)}>Approve list & review order <Icon name="arrow" /></button></div>
      <small className="privacy-note">Next, you can edit quantities and explicitly confirm checkout.</small>
    </div>}
  </div></div>;
}

function ReferralGate({ initialCode, accepted, close }) {
  const [code, setCode] = useState(initialCode || '');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const submit = async event => {
    event.preventDefault();
    setChecking(true); setError('');
    try {
      const result = await api('/referrals/validate', { method: 'POST', body: JSON.stringify({ code }) });
      accepted(result.code);
    } catch (reason) { setError(reason.message); }
    finally { setChecking(false); }
  };
  return <div className="referral-gate"><div className="referral-gate-card"><div className="gift-mark">🎁</div><span className="eyebrow">YOU WERE INVITED</span><h1>Enter your referral code</h1><p>Confirm the code to open Shri Vegetables. Your first confirmed order will unlock a reward for the friend who invited you.</p><form onSubmit={submit}><input autoFocus required value={code} onChange={event => setCode(event.target.value.toUpperCase())} placeholder="SHRI-XXXXXX" /><button className="primary" disabled={checking}>{checking ? 'Checking…' : <>Enter Shri Vegetables <Icon name="arrow" /></>}</button></form>{error && <div className="notice error-notice">{error}</div>}<button className="text-button" onClick={close}>Continue without referral</button></div></div>;
}

function ReferralBox({ form, selectedRewardId, onSelectReward }) {
  const [profile, setProfile] = useState(() => readLocal('shri_referral_owner', null));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const saveProfile = value => {
    setProfile(value);
    localStorage.setItem('shri_referral_owner', JSON.stringify({ code: value.code, phone: form.phone || profile?.phone, ...value }));
  };
  const refresh = useCallback(async () => {
    const saved = readLocal('shri_referral_owner', null);
    if (!saved?.code || !saved?.phone) return;
    try {
      const result = await api('/referrals/status', { method: 'POST', body: JSON.stringify({ code: saved.code, phone: saved.phone }) });
      setProfile({ ...saved, ...result });
      localStorage.setItem('shri_referral_owner', JSON.stringify({ ...saved, ...result }));
    } catch { /* Keep the locally saved referral visible while offline. */ }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const createReferral = async () => {
    setMessage('');
    if (!form.name || String(form.phone).replace(/\D/g, '').length < 10) { setMessage('Enter your name and valid phone number in Delivery Details first.'); return; }
    setBusy(true);
    try {
      const result = await api('/referrals', { method: 'POST', body: JSON.stringify({ name: form.name, phone: form.phone }) });
      saveProfile({ ...result, phone: form.phone });
      setMessage('Your private referral link is ready.');
    } catch (reason) { setMessage(reason.message); }
    finally { setBusy(false); }
  };
  const share = async () => {
    const text = 'Shop fresh with Shri Vegetables. Enter my referral code ' + profile.code + ': ' + profile.link;
    try {
      if (navigator.share) await navigator.share({ title: 'Shri Vegetables referral', text, url: profile.link });
      else { await navigator.clipboard.writeText(text); setMessage('Referral link and code copied.'); }
    } catch (error) { if (error.name !== 'AbortError') setMessage('Copy this link: ' + profile.link); }
  };

  return <div className="referral-box"><div className="referral-title"><div><span className="eyebrow">REFER & EARN</span><h3>Invite friends from your basket</h3></div><span>₹25 → ₹50 → ₹75</span></div>
    {!profile?.code ? <><p>Create your personal code and link. Rewards unlock after each invited friend places their first confirmed order.</p><button className="soft-button" onClick={createReferral} disabled={busy}>{busy ? 'Creating…' : 'Create referral code & link'}</button></>
      : <><div className="referral-code-row"><div><small>YOUR CODE</small><b>{profile.code}</b></div><button className="primary" onClick={share}>Share link</button></div>
        <div className="reward-steps">{profile.rewards?.map((reward, index) => <button type="button" key={reward.id} disabled={!reward.unlocked || reward.used} className={(selectedRewardId === reward.id ? 'selected ' : '') + (reward.used ? 'used' : reward.unlocked ? 'unlocked' : 'locked')} onClick={() => onSelectReward(reward.id)}>
          <span>{index + 1}</span><b>{money(reward.amount)}</b><small>{reward.used ? 'Used' : reward.unlocked ? 'Use reward' : 'Locked'}</small>
        </button>)}</div>
        <p className="referral-progress">{Math.min(profile.referralCount || 0, 3)} of 3 successful referrals · <button type="button" onClick={refresh}>Refresh</button></p>
      </>}
    {message && <small className="referral-message">{message}</small>}
  </div>;
}

function Cart({ cart, setCart, navigate, reloadStore }) {
  const [form, setForm] = useState(() => readLocal('shri_customer', { name: '', phone: '', address: '', deliverySlot: 'Today · 5 PM – 8 PM', paymentMethod: 'Cash on delivery', notes: '' }));
  const [approved, setApproved] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  const [couponInput, setCouponInput] = useState('');
  const [rewardId, setRewardId] = useState('');
  const [quote, setQuote] = useState(null);
  const [saving, setSaving] = useState(false);
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const lastBasket = readLocal('shri_last_basket', []);
  const pendingReferral = localStorage.getItem('shri_pending_referral') || '';

  useEffect(() => { localStorage.setItem('shri_customer', JSON.stringify(form)); }, [form]);
  useEffect(() => { setQuote(null); }, [subtotal, form.phone, couponInput, rewardId]);
  const quantity = (id, change) => setCart(current => current.map(item => item.id === id ? { ...item, quantity: Math.max(0, Math.min(item.stock, item.quantity + change)) } : item).filter(item => item.quantity > 0));

  const applySavings = async () => {
    if (!couponInput.trim() && !rewardId) { setError('Enter SHRI50 or select an unlocked referral reward.'); return; }
    setSaving(true); setError('');
    try {
      const result = await api('/promotions/quote', { method: 'POST', body: JSON.stringify({ phone: form.phone, couponCode: couponInput, rewardId, items: cart.map(({ id, quantity }) => ({ id, quantity })) }) });
      setQuote(result);
    } catch (reason) { setError(reason.message); setQuote(null); }
    finally { setSaving(false); }
  };

  const placeOrder = async event => {
    event.preventDefault();
    if (!approved || placing) return;
    setPlacing(true); setError('');
    try {
      const couponApplied = quote?.promotions?.some(item => item.type === 'coupon') ? couponInput : '';
      const rewardApplied = quote?.promotions?.some(item => item.type === 'referral') ? rewardId : '';
      const created = await api('/orders', { method: 'POST', body: JSON.stringify({
        customer: form,
        items: cart.map(({ id, quantity }) => ({ id, quantity })),
        couponCode: couponApplied,
        referralRewardId: rewardApplied,
        referralCode: pendingReferral
      }) });
      localStorage.setItem('shri_last_basket', JSON.stringify(cart));
      if (pendingReferral) localStorage.removeItem('shri_pending_referral');
      setCart([]); setOrder(created); await reloadStore();
    } catch (reason) { setError(reason.message); setQuote(null); }
    finally { setPlacing(false); }
  };

  if (order) return <main className="order-success"><div className="success-mark"><Icon name="check" /></div><span className="eyebrow">ORDER CONFIRMED</span><h1>Thank you, {order.customer.name}.</h1><p>Your order <b>{order.id}</b> is confirmed for <b>{order.customer.deliverySlot}</b>. The store has been notified.</p><div className="success-total"><span>{order.discount > 0 ? 'Total after savings' : 'Total'}</span><strong>{money(order.total)}</strong></div>{order.discount > 0 && <p className="saving-confirmed">You saved {money(order.discount)} on this order.</p>}<button className="primary" onClick={() => navigate('shop')}>Continue shopping <Icon name="arrow" /></button></main>;

  return <main className="cart-page"><div className="page-title"><span className="eyebrow">YOUR FRESH ORDER</span><h1>Basket & delivery</h1><p>Review every item before confirming.</p></div>
    {!cart.length ? <div className="empty-state basket-empty"><span>🧺</span><h3>Your basket is empty</h3><p>Choose fresh produce or ask the AI helper to make a list.</p><div>{lastBasket.length > 0 && <button className="soft-button" onClick={() => setCart(lastBasket)}>Repeat last basket</button>}<button className="primary" onClick={() => navigate('shop')}>Shop vegetables <Icon name="arrow" /></button></div></div>
      : <div className="checkout-layout">
        <section className="basket-lines"><h2>Your items <small>{cart.reduce((sum, item) => sum + item.quantity, 0)} items</small></h2>
          {cart.map(item => <article className="basket-line" key={item.id}><ProductImage src={item.imageUrl} alt={item.name} /><div><b>{item.name}</b><span>{item.hindiName} · {money(item.price)} / {item.unit}</span></div><div className="counter"><button onClick={() => quantity(item.id, -1)}><Icon name="minus" /></button><b>{item.quantity}</b><button onClick={() => quantity(item.id, 1)}><Icon name="plus" /></button></div><strong>{money(item.price * item.quantity)}</strong><button className="remove-button" onClick={() => setCart(current => current.filter(product => product.id !== item.id))}><Icon name="trash" /></button></article>)}
          <button className="text-button" onClick={() => navigate('shop')}>← Add more products</button>
          <ReferralBox form={form} selectedRewardId={rewardId} onSelectReward={id => setRewardId(current => current === id ? '' : id)} />
        </section>
        <form className="delivery-card" onSubmit={placeOrder}><span className="eyebrow">DELIVERY DETAILS</span><h2>Where should we bring it?</h2>
          <div className="two-fields"><label>Full name<input required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="Your name" /></label><label>Phone number<input required inputMode="tel" value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} placeholder="+91…" /></label></div>
          <label>Complete address<textarea required value={form.address} onChange={event => setForm({ ...form, address: event.target.value })} placeholder="House, street, landmark and area" /></label>
          <div className="two-fields"><label>Delivery time<select value={form.deliverySlot} onChange={event => setForm({ ...form, deliverySlot: event.target.value })}><option>Today · 5 PM – 8 PM</option><option>Tomorrow · 8 AM – 11 AM</option><option>Tomorrow · 5 PM – 8 PM</option><option>As soon as possible</option></select></label><label>Payment<select value={form.paymentMethod} onChange={event => setForm({ ...form, paymentMethod: event.target.value })}><option>Cash on delivery</option><option>UPI at delivery</option></select></label></div>
          <label>Notes (optional)<input value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} placeholder="Gate, ripeness or delivery notes" /></label>
          {pendingReferral && <div className="linked-referral"><Icon name="check" /><div><b>Referral linked: {pendingReferral}</b><small>Your first confirmed order unlocks your friend’s next reward.</small></div></div>}
          <div className="promotion-box"><span className="eyebrow">COUPON & REWARDS</span><div className="coupon-row"><input value={couponInput} onChange={event => setCouponInput(event.target.value.toUpperCase().replace(/\s/g, ''))} placeholder="Enter coupon code" /><button type="button" className="details-button" onClick={applySavings} disabled={saving}>{saving ? 'Checking…' : 'Apply savings'}</button></div><small>Use SHRI50 for ₹50 off. Limited to the first 1,000 phone accounts, one use each.</small>{rewardId && <p>Referral reward selected. Tap Apply savings to verify it.</p>}{quote?.discount > 0 && <div className="applied-saving"><Icon name="check" />Savings applied: {money(quote.discount)}</div>}</div>
          <div className="bill"><span>Subtotal</span><b>{money(subtotal)}</b>{quote?.discount > 0 && <><span>Coupon & referral savings</span><b className="discount-line">−{money(quote.discount)}</b></>}<span>Delivery</span><b>Confirmed by store</b><strong>Total</strong><strong>{money(quote?.total ?? subtotal)}</strong></div>
          <label className="approval"><input type="checkbox" checked={approved} onChange={event => setApproved(event.target.checked)} />I reviewed the basket and agree to place this order.</label>
          {error && <div className="notice error-notice">{error}</div>}
          <button className="primary place-order" disabled={!approved || placing}>{placing ? <><span className="spinner" />Confirming…</> : <>Confirm & place order <Icon name="arrow" /></>}</button>
        </form>
      </div>}
  </main>;
}

const blankProduct = { hindiName: '', name: '', category: 'Fruit vegetables', price: '', stock: '', unit: 'kg', imageUrl: fallbackImage, description: '' };
function ProductForm({ product, onCancel, onSaved }) {
  const [form, setForm] = useState(product || blankProduct);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const field = (key, label, type = 'text') => <label>{label}<input required={['name', 'hindiName', 'imageUrl', 'price', 'stock'].includes(key)} type={type} value={form[key] ?? ''} onChange={event => setForm({ ...form, [key]: event.target.value })} /></label>;
  const save = async event => {
    event.preventDefault(); setSaving(true); setError('');
    try { await api(product?.id ? '/products/' + product.id : '/products', { method: product?.id ? 'PUT' : 'POST', body: JSON.stringify(form) }); onSaved(); }
    catch (reason) { setError(reason.message); }
    finally { setSaving(false); }
  };
  return <form className="product-form" onSubmit={save}><div className="form-title"><h2>{product?.id ? 'Edit ' + product.name : 'Add a product'}</h2><button type="button" className="close-button" onClick={onCancel}><Icon name="close" /></button></div><div className="form-grid">{field('name', 'English name')}{field('hindiName', 'Hindi name')}{field('category', 'Category')}{field('price', 'Price (₹)', 'number')}{field('stock', 'Stock', 'number')}{field('unit', 'Unit')}{field('imageUrl', 'Matched image path')}</div><label>Description<textarea value={form.description || ''} onChange={event => setForm({ ...form, description: event.target.value })} /></label>{error && <div className="notice error-notice">{error}</div>}<button className="primary" disabled={saving}>{saving ? 'Saving…' : 'Save product'}</button></form>;
}

function urlBase64ToUint8Array(value) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(char => char.charCodeAt(0)));
}
function Admin({ reloadStore }) {
  const [authenticated, setAuthenticated] = useState(Boolean(localStorage.getItem('shri_admin_token')));
  const [credentials, setCredentials] = useState({ email: 'admin@shrivegetables.in', password: '' });
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [promotions, setPromotions] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [alerts, setAlerts] = useState('');
  const knownOrders = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const [catalogue, orderList] = await Promise.all([api('/products'), api('/orders')]);
      setProducts(catalogue); setOrders(orderList); setError('');
      if (knownOrders.current) {
        const fresh = orderList.find(order => !knownOrders.current.has(order.id));
        if (fresh && Notification.permission === 'granted') new Notification('New Shri Vegetables order', { body: fresh.customer.name + ' · ' + money(fresh.total), icon: '/icons/shri-192.svg' });
      }
      knownOrders.current = new Set(orderList.map(order => order.id));
    } catch (reason) {
      setError(reason.message);
      if (/sign in/i.test(reason.message)) { localStorage.removeItem('shri_admin_token'); setAuthenticated(false); }
    }
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    refresh();
    const timer = setInterval(refresh, 12000);
    return () => clearInterval(timer);
  }, [authenticated, refresh]);

  const login = async event => {
    event.preventDefault(); setError('');
    try {
      const data = await api('/admin/login', { method: 'POST', body: JSON.stringify(credentials) });
      localStorage.setItem('shri_admin_token', data.token); setAuthenticated(true);
    } catch (reason) { setError(reason.message); }
  };
  const saved = () => { setEditing(null); setAdding(false); refresh(); reloadStore(); };
  const remove = async product => {
    if (!confirm('Remove ' + product.name + ' from the store?')) return;
    try { await api('/products/' + product.id, { method: 'DELETE' }); saved(); } catch (reason) { setError(reason.message); }
  };
  const enableAlerts = async () => {
    setAlerts(''); setError('');
    try {
      if (!('Notification' in window) || !('serviceWorker' in navigator)) throw new Error('This browser does not support device notifications.');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Notification permission was not allowed.');
      const config = await api('/push/config');
      if (!config.configured) { setAlerts('On-screen alerts are enabled. Add VAPID keys in Render for alerts when the site is closed.'); return; }
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(config.publicKey) });
      await api('/admin/push-subscriptions', { method: 'POST', body: JSON.stringify(subscription) });
      setAlerts('Device alerts enabled. New orders can notify this phone or computer.');
      new Notification('Shri Vegetables alerts are ready', { body: 'You will receive new-order alerts on this device.', icon: '/icons/shri-192.svg' });
    } catch (reason) { setError(reason.message); }
  };

  if (!authenticated) return <main className="admin-login"><div className="login-mark">श्री</div><span className="eyebrow">SECURE ADMIN ACCESS</span><h1>Store control</h1><p>Sign in to manage products, stock and incoming orders.</p><form onSubmit={login}><label>Email<input required type="email" value={credentials.email} onChange={event => setCredentials({ ...credentials, email: event.target.value })} /></label><label>Password<input required type="password" value={credentials.password} onChange={event => setCredentials({ ...credentials, password: event.target.value })} /></label><button className="primary">Sign in <Icon name="arrow" /></button></form>{error && <div className="notice error-notice">{error}</div>}</main>;

  const unread = orders.filter(order => !order.adminRead);
  return <main className="admin-page">
    <div className="admin-heading"><div><span className="eyebrow">ADMIN PANEL</span><h1>Good day. Here’s your store.</h1><p>Orders refresh automatically every 12 seconds.</p></div><div className="admin-actions"><button className="notify-button" onClick={enableAlerts}><Icon name="bell" />Enable device alerts</button><button className="primary" onClick={() => { setAdding(true); setEditing(null); }}><Icon name="plus" />Add product</button></div></div>
    {alerts && <div className="notice success-notice">{alerts}</div>}{error && <div className="notice error-notice">{error}</div>}
    <section className="admin-stats"><div><span>Catalogue</span><b>{products.length}</b><small>active products</small></div><div><span>Orders</span><b>{orders.length}</b><small>all time</small></div><div className={unread.length ? 'attention' : ''}><span>Needs attention</span><b>{unread.length}</b><small>new orders</small></div><div><span>Catalogue value</span><b>{money(products.reduce((sum, product) => sum + product.price * product.stock, 0))}</b><small>current stock</small></div></section>
    {promotions && <div className="admin-promo-card"><div><div><span>SHRI50 USAGE</span><b>{promotions.coupon.used} / {promotions.coupon.limit}</b><small>{promotions.coupon.remaining} account uses remaining</small></div><div><span>REFERRAL MEMBERS</span><b>{promotions.referrals.length}</b><small>{promotions.referrals.reduce((sum, item) => sum + item.referralCount, 0)} successful referrals</small></div></div></div>}
    {(adding || editing) && <ProductForm product={editing} onCancel={() => { setAdding(false); setEditing(null); }} onSaved={saved} />}
    <section className="admin-section"><div className="admin-section-title"><div><h2>Incoming orders</h2><p>Newest first · live refresh</p></div><button className="text-button" onClick={refresh}>Refresh now</button></div>
      {!orders.length ? <div className="empty-state small"><span>🔔</span><h3>No orders yet</h3></div> : <div className="order-list">{orders.map(order => <article className={'admin-order ' + (!order.adminRead ? 'unread' : '')} key={order.id}>
        <div className="order-top"><div><span className="order-id">{order.id}</span>{!order.adminRead && <b className="new-badge">NEW</b>}<h3>{order.customer.name}</h3><p>{order.customer.phone} · {order.customer.address}</p></div><div><strong>{money(order.total)}</strong><span>{new Date(order.createdAt).toLocaleString('en-IN')}</span></div></div>
        <div className="order-items">{order.items.map(item => <span key={item.id}>{item.name} × {item.quantity}</span>)}</div>
        <div className="order-meta">{order.discount > 0 && <span>🏷 Saved {money(order.discount)}</span>}<span>🕒 {order.customer.deliverySlot || 'As soon as possible'}</span><span>💳 {order.customer.paymentMethod || 'Cash on delivery'}</span>{order.customer.notes && <span>📝 {order.customer.notes}</span>}</div>
        {!order.adminRead && <button className="mark-read" onClick={() => api('/orders/' + order.id + '/read', { method: 'PATCH' }).then(refresh)}><Icon name="check" />Mark handled</button>}
      </article>)}</div>}
    </section>
    <section className="admin-section"><div className="admin-section-title"><div><h2>Product catalogue</h2><p>Every name must stay matched to its photograph.</p></div></div>
      <div className="admin-products">{products.map(product => <article key={product.id}><ProductImage src={product.imageUrl} alt={product.name} /><div><b>{product.name}</b><span>{product.hindiName}</span><small>{product.stock} {product.unit} in stock · {money(product.price)}</small></div><button className="details-button" onClick={() => { setEditing(product); setAdding(false); }}>Edit</button><button className="remove-button labelled" onClick={() => remove(product)}><Icon name="trash" />Remove</button></article>)}</div>
    </section>
    <button className="signout" onClick={() => { localStorage.removeItem('shri_admin_token'); setAuthenticated(false); }}>Sign out of admin</button>
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
