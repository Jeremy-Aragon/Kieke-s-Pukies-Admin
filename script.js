/* ---------------- DATA ---------------- */
// Products live in Supabase (table: products) so they can be managed from the
// admin panel. loadProducts() fetches them once at startup; see INIT below.
let products = [];
async function loadProducts(){
  const { data, error } = await supabaseClient
    .from('products')
    .select('*')
    .eq('active', true)
    .order('id');
  if(error){ console.error(error); return; }
  products = (data || []).map(p => ({
    id: p.id, name: p.name, cat: p.category,
    price: Number(p.price), icon: p.icon, desc: p.description,
    image: p.image_url || null
  }));
}

/* Renders a product photo when one's set on the product, falling back to the hand-drawn icon. */
function productArt(p){
  return p.image ? `<img src="${p.image}" alt="${p.name}" loading="lazy">` : (icons[p.icon] || '');
}
function productArtClass(p){
  return p.image ? 'has-image' : '';
}

let cart = []; // {id, qty}
let currentUser = null; // {id, email, name, avatar} from Supabase, or null when signed out
let pendingRedirect = null; // page to go to once login succeeds (set when a gated page is blocked)
let lastOrder = null;
let currentModalProduct = null;
let modalQty = 1;
let activeFilter = "All";

/* ---------------- HELPERS ---------------- */
function findProduct(id){ return products.find(p => p.id === id); }
function cartCount(){ return cart.reduce((s,i)=>s+i.qty,0); }
function cartTotal(){ return cart.reduce((s,i)=> s + findProduct(i.id).price * i.qty, 0); }
function money(n){ return "$" + n.toFixed(2); }
const FREE_SHIPPING_THRESHOLD = 40;
const SHIPPING_COST = 5;
function calcShipping(subtotal){ return subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_COST; }

function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._h);
  showToast._h = setTimeout(()=> t.classList.remove('show'), 2200);
}

/* ---------------- RENDER: product cards ---------------- */
function productCard(p){
  return `<div class="card" data-open="${p.id}">
    <div class="card-art ${productArtClass(p)}">${productArt(p)}</div>
    <div class="card-body">
      <div class="card-cat">${p.cat}</div>
      <div class="card-name">${p.name}</div>
      <div class="card-price">${money(p.price)}</div>
    </div>
  </div>`;
}

function renderHomeFeatured(){
  document.getElementById('homeFeatured').innerHTML =
    products.slice(0,4).map(productCard).join('');
}

function renderFilters(){
  const cats = ["All", ...new Set(products.map(p=>p.cat))];
  document.getElementById('filterBar').innerHTML = cats.map(c =>
    `<button data-filter="${c}" class="${c===activeFilter?'active':''}">${c}</button>`
  ).join('');
}

function renderShopGrid(){
  const list = activeFilter === "All" ? products : products.filter(p=>p.cat===activeFilter);
  document.getElementById('shopGrid').innerHTML = list.map(productCard).join('');
  document.getElementById('resultCount').textContent = `${list.length} product${list.length!==1?'s':''}`;
}

/* ---------------- MODAL ---------------- */
function openModal(id){
  currentModalProduct = findProduct(id);
  modalQty = 1;
  document.getElementById('modalArt').className = 'modal-art ' + productArtClass(currentModalProduct);
  document.getElementById('modalArt').innerHTML = productArt(currentModalProduct);
  document.getElementById('modalCat').textContent = currentModalProduct.cat;
  document.getElementById('modalName').textContent = currentModalProduct.name;
  document.getElementById('modalPrice').textContent = money(currentModalProduct.price);
  document.getElementById('modalDesc').textContent = currentModalProduct.desc;
  document.getElementById('qtyValue').textContent = modalQty;
  document.getElementById('modalOverlay').classList.add('open');
}
function closeModal(){ document.getElementById('modalOverlay').classList.remove('open'); }

document.getElementById('modalClose').addEventListener('click', closeModal);
document.getElementById('modalOverlay').addEventListener('click', e => { if(e.target.id==='modalOverlay') closeModal(); });
document.getElementById('qtyMinus').addEventListener('click', ()=>{ modalQty = Math.max(1, modalQty-1); document.getElementById('qtyValue').textContent = modalQty; });
document.getElementById('qtyPlus').addEventListener('click', ()=>{ modalQty = Math.min(20, modalQty+1); document.getElementById('qtyValue').textContent = modalQty; });
document.getElementById('addToCartBtn').addEventListener('click', ()=>{
  const existing = cart.find(i=>i.id===currentModalProduct.id);
  if(existing){ existing.qty += modalQty; } else { cart.push({id:currentModalProduct.id, qty:modalQty}); }
  updateCartCount();
  closeModal();
  showToast(`Added ${modalQty} × ${currentModalProduct.name} to cart`);
});

/* delegate product card clicks */
document.addEventListener('click', e => {
  const card = e.target.closest('[data-open]');
  if(card){ openModal(parseInt(card.dataset.open)); }
});

/* ---------------- CART PAGE ---------------- */
function updateCartCount(){
  const n = cartCount();
  const el = document.getElementById('cartCount');
  el.textContent = n;
  el.classList.toggle('zero', n === 0);
}

function renderCartPage(){
  const el = document.getElementById('cartContent');
  if(cart.length === 0){
    el.innerHTML = `<div class="empty-state">
      <svg class="glyph" viewBox="0 0 24 24" fill="none"><path d="M3 4h2l2.4 12.2A2 2 0 0 0 9.36 18h7.5a2 2 0 0 0 1.96-1.6L20.5 8H6" stroke="currentColor" stroke-width="1.4"/><circle cx="10" cy="21" r="1.2" fill="currentColor"/><circle cx="17" cy="21" r="1.2" fill="currentColor"/></svg>
      <h3 style="font-size:20px;margin-bottom:8px;">Your bag is empty</h3>
      <p style="color:var(--ink-soft);margin-bottom:24px;">Browse today's counter and add something fresh.</p>
      <button class="btn btn-primary" data-nav="shop">Browse products</button>
    </div>`;
    return;
  }
  const rows = cart.map(item=>{
    const p = findProduct(item.id);
    return `<div class="cart-row" data-id="${p.id}">
      <div class="thumb ${productArtClass(p)}">${productArt(p)}</div>
      <div>
        <div class="name">${p.name}</div>
        <div class="cat">${p.cat} · ${money(p.price)} each</div>
        <button class="remove" data-remove="${p.id}">Remove</button>
      </div>
      <div class="qty-stepper">
        <button data-dec="${p.id}">−</button>
        <span>${item.qty}</span>
        <button data-inc="${p.id}">+</button>
      </div>
      <div class="line-total">${money(p.price*item.qty)}</div>
    </div>`;
  }).join('');

  const subtotal = cartTotal();
  const shipping = calcShipping(subtotal);
  const total = subtotal + shipping;

  el.innerHTML = `<div class="cart-layout">
    <div>${rows}</div>
    <div class="summary-box">
      <h3 style="margin-bottom:16px;">Order summary</h3>
      <div class="summary-row"><span>Subtotal</span><span>${money(subtotal)}</span></div>
      <div class="summary-row"><span>Shipping</span><span>${shipping===0?'Free':money(shipping)}</span></div>
      <div class="summary-row total"><span>Total</span><span>${money(total)}</span></div>
      <button class="btn btn-primary btn-full" style="margin-top:18px;" data-nav="checkout">Proceed to checkout</button>
      ${subtotal<FREE_SHIPPING_THRESHOLD ? `<p style="font-size:12.5px;color:var(--ink-soft);margin-top:12px;">Add ${money(FREE_SHIPPING_THRESHOLD-subtotal)} more for free shipping.</p>` : ''}
    </div>
  </div>`;
}

document.addEventListener('click', e=>{
  const inc = e.target.closest('[data-inc]');
  const dec = e.target.closest('[data-dec]');
  const rem = e.target.closest('[data-remove]');
  if(inc){ const item = cart.find(i=>i.id===parseInt(inc.dataset.inc)); item.qty++; renderCartPage(); updateCartCount(); }
  if(dec){ const item = cart.find(i=>i.id===parseInt(dec.dataset.dec)); item.qty--; if(item.qty<=0) cart = cart.filter(i=>i!==item); renderCartPage(); updateCartCount(); }
  if(rem){ cart = cart.filter(i=>i.id!==parseInt(rem.dataset.remove)); renderCartPage(); updateCartCount(); }
});

/* ---------------- CHECKOUT ---------------- */
function renderCheckoutSummary(){
  const subtotal = cartTotal();
  const shipping = calcShipping(subtotal);
  const total = subtotal + shipping;
  const lines = cart.map(item=>{
    const p = findProduct(item.id);
    return `<div class="mini-line"><span>${item.qty} × ${p.name}</span><span>${money(p.price*item.qty)}</span></div>`;
  }).join('');
  document.getElementById('checkoutSummary').innerHTML = `
    <h3 style="margin-bottom:14px;">Order summary</h3>
    ${lines || '<p style="color:var(--ink-soft);font-size:14px;">Your cart is empty.</p>'}
    <div class="summary-row"><span>Subtotal</span><span>${money(subtotal)}</span></div>
    <div class="summary-row"><span>Shipping</span><span>${shipping===0?'Free':money(shipping)}</span></div>
    <div class="summary-row total"><span>Total</span><span>${money(total)}</span></div>
  `;
}

document.getElementById('checkoutForm').addEventListener('submit', async e=>{
  e.preventDefault();
  if(cart.length === 0){ showToast("Your cart is empty"); return; }
  if(!currentUser){ showToast("Please log in to check out"); goTo('login'); return; }

  const subtotal = cartTotal();
  const shipping = calcShipping(subtotal);
  const submitBtn = e.target.querySelector('button[type="submit"]');
  if(submitBtn) submitBtn.setAttribute('disabled','true');

  const { data, error } = await supabaseClient.from('orders').insert({
    order_number: "HK-" + Math.floor(100000 + Math.random()*899999),
    user_id: currentUser.id,
    items: cart.map(i=>({...findProduct(i.id), qty:i.qty})),
    subtotal, shipping, total: subtotal+shipping,
    customer_name: document.getElementById('chName').value,
    address: document.getElementById('chAddr').value,
    city: document.getElementById('chCity').value
  }).select().single();

  if(submitBtn) submitBtn.removeAttribute('disabled');

  if(error){
    showToast("Couldn't place order — please try again");
    console.error(error);
    return;
  }

  lastOrder = data;
  cart = [];
  updateCartCount();
  goTo('confirmation');
  showToast("Order placed");
});

function renderConfirmation(){
  if(!lastOrder){
    document.getElementById('orderSummary').innerHTML = `<p style="color:var(--ink-soft);">No recent order found.</p>`;
    return;
  }
  const lines = lastOrder.items.map(p=>
    `<div class="mini-line"><span>${p.qty} × ${p.name}</span><span>${money(p.price*p.qty)}</span></div>`
  ).join('');
  document.getElementById('orderSummary').innerHTML = `
    <div class="order-id">${lastOrder.order_number}</div>
    <p style="font-size:13.5px;color:var(--ink-soft);margin-bottom:16px;">Shipping to ${lastOrder.customer_name}, ${lastOrder.address}, ${lastOrder.city}</p>
    ${lines}
    <div class="summary-row"><span>Subtotal</span><span>${money(lastOrder.subtotal)}</span></div>
    <div class="summary-row"><span>Shipping</span><span>${lastOrder.shipping===0?'Free':money(lastOrder.shipping)}</span></div>
    <div class="summary-row total"><span>Total paid</span><span>${money(lastOrder.total)}</span></div>
    <button type="button" class="btn btn-outline btn-full" style="margin-top:18px;" id="trackOrderBtn">Track this order</button>
  `;
  document.getElementById('trackOrderBtn').addEventListener('click', ()=> goTo('orders'));
}

/* ---------------- ORDER TRACKING ---------------- */
const ORDER_STEPS = [
  {key:'placed', label:'Order Placed'},
  {key:'preparing', label:'Preparing'},
  {key:'out_for_delivery', label:'Out for Delivery'},
  {key:'delivered', label:'Delivered'}
];

function orderTimelineHTML(status){
  const idx = Math.max(0, ORDER_STEPS.findIndex(s=>s.key===status));
  return `<div class="order-timeline">
    ${ORDER_STEPS.map((s,i)=>`
      <div class="timeline-step ${i<idx?'done':''} ${i===idx?'current':''}">
        <div class="timeline-dot"></div>
        <div class="timeline-label">${s.label}</div>
      </div>`).join('')}
  </div>`;
}

function orderCardHTML(o){
  const date = new Date(o.created_at).toLocaleDateString(undefined, {month:'short', day:'numeric', year:'numeric'});
  const lines = o.items.map(p=>`<div class="mini-line"><span>${p.qty} × ${p.name}</span><span>${money(p.price*p.qty)}</span></div>`).join('');
  return `<div class="order-card" style="margin-top:0;margin-bottom:20px;">
    <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;">
      <div class="order-id">${o.order_number}</div>
      <div style="font-size:13px;color:var(--ink-soft);">${date}</div>
    </div>
    ${orderTimelineHTML(o.status)}
    <div style="margin-top:18px;">${lines}</div>
    <div class="summary-row total"><span>Total</span><span>${money(o.total)}</span></div>
  </div>`;
}

async function renderOrdersPage(){
  const el = document.getElementById('ordersContent');
  if(!el || !currentUser) return;
  el.innerHTML = `<p style="color:var(--ink-soft);">Loading your orders…</p>`;

  const { data, error } = await supabaseClient
    .from('orders')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending:false });

  if(error){
    el.innerHTML = `<p style="color:var(--ink-soft);">Couldn't load your orders — try again.</p>`;
    console.error(error);
    return;
  }
  if(!data || data.length === 0){
    el.innerHTML = `<div class="empty-state">
      <h3 style="font-size:20px;margin-bottom:8px;">No orders yet</h3>
      <p style="color:var(--ink-soft);margin-bottom:24px;">Your placed orders will show up here.</p>
      <button class="btn btn-primary" data-nav="shop">Browse products</button>
    </div>`;
    return;
  }
  el.innerHTML = data.map(orderCardHTML).join('');
}

/* Live-updates the orders page if an order's status changes while it's open. */
let ordersRealtimeChannel = null;
function subscribeOrdersRealtime(){
  if(!currentUser) return;
  if(ordersRealtimeChannel){ supabaseClient.removeChannel(ordersRealtimeChannel); }
  ordersRealtimeChannel = supabaseClient
    .channel('orders-' + currentUser.id)
    .on('postgres_changes',
      { event:'*', schema:'public', table:'orders', filter:`user_id=eq.${currentUser.id}` },
      ()=>{ if(location.hash.slice(1) === 'orders') renderOrdersPage(); }
    )
    .subscribe();
}
function unsubscribeOrdersRealtime(){
  if(ordersRealtimeChannel){ supabaseClient.removeChannel(ordersRealtimeChannel); ordersRealtimeChannel = null; }
}

/* ---------------- AUTH (Supabase + Google) ---------------- */
function mapSupabaseUser(u){
  if(!u) return null;
  const meta = u.user_metadata || {};
  return {
    id: u.id,
    email: u.email,
    name: meta.full_name || meta.name || null,
    avatar: meta.avatar_url || meta.picture || null
  };
}

function updateLoginNav(){
  const label = document.getElementById('loginNavLabel');
  label.textContent = currentUser ? (currentUser.name ? currentUser.name.split(' ')[0] : currentUser.email.split('@')[0]) : "Log In";
}

function renderAuthBox(){
  const box = document.getElementById('authBox');
  if(!box) return;

  if(currentUser){
    const initial = (currentUser.name || currentUser.email || "?").trim()[0].toUpperCase();
    box.innerHTML = `
      <div class="account-card">
        ${currentUser.avatar
          ? `<img class="account-avatar" src="${currentUser.avatar}" alt="${currentUser.name || currentUser.email}">`
          : `<div class="account-avatar-fallback">${initial}</div>`}
        <div class="account-name">${currentUser.name || currentUser.email}</div>
        <div class="account-email">${currentUser.email}</div>
        <button type="button" class="btn btn-primary btn-full" id="myOrdersBtn" style="margin-top:24px;">My Orders</button>
        <button type="button" class="btn btn-outline btn-full" id="signOutBtn" style="margin-top:10px;">Sign out</button>
      </div>
    `;
    document.getElementById('myOrdersBtn').addEventListener('click', ()=> goTo('orders'));
    document.getElementById('signOutBtn').addEventListener('click', signOutUser);
  } else {
    box.innerHTML = `
      <div id="googleBtnContainer" style="display:flex;justify-content:center;min-height:44px;"></div>
      <div style="text-align:center;margin-top:16px;font-size:13.5px;color:var(--ink-soft);">
        <a href="#" style="color:var(--moss);font-weight:600;" id="guestContinue">Continue as guest</a>
      </div>
    `;
    renderGoogleButton();
    document.getElementById('guestContinue').addEventListener('click', e=>{
      e.preventDefault();
      pendingRedirect = null;
      goTo('home');
      showToast("Continuing as guest");
    });
  }
}

/* Waits for the Google Identity Services script to be ready, then calls fn. */
function whenGoogleReady(fn){
  if(window.google && google.accounts && google.accounts.id){ fn(); }
  else{ setTimeout(()=>whenGoogleReady(fn), 100); }
}

let googleIdInitialized = false;
function renderGoogleButton(){
  whenGoogleReady(()=>{
    if(!googleIdInitialized){
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleGoogleCredentialResponse,
        auto_select: false,
        cancel_on_tap_outside: true
      });
      googleIdInitialized = true;
    }
    const container = document.getElementById('googleBtnContainer');
    if(container){
      container.innerHTML = '';
      google.accounts.id.renderButton(container, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        shape: 'pill',
        text: 'continue_with',
        width: 320
      });
    }
    // Also offer the One Tap popup alongside the button.
    google.accounts.id.prompt();
  });
}

async function handleGoogleCredentialResponse(response){
  const { error } = await supabaseClient.auth.signInWithIdToken({
    provider: 'google',
    token: response.credential
  });
  if(error){
    showToast("Google sign-in failed — try again");
  }
  // onAuthStateChange below picks up the new session and re-renders the UI.
}

async function signOutUser(){
  await supabaseClient.auth.signOut();
  unsubscribeOrdersRealtime();
  showToast("Signed out");
  goTo('home');
}

supabaseClient.auth.onAuthStateChange((_event, session) => {
  currentUser = mapSupabaseUser(session?.user);
  updateLoginNav();
  if(currentUser){
    subscribeOrdersRealtime();
    if(pendingRedirect){
      const dest = pendingRedirect;
      pendingRedirect = null;
      goTo(dest);
      return;
    }
  }
  if(location.hash.slice(1) === 'login') renderAuthBox();
});

/* ---------------- CONTACT form ---------------- */
document.getElementById('contactForm').addEventListener('submit', e=>{
  e.preventDefault();
  showToast("Message sent — we'll reply within a day");
  e.target.reset();
});

/* ---------------- FILTER BAR ---------------- */
document.addEventListener('click', e=>{
  const f = e.target.closest('[data-filter]');
  if(f){ activeFilter = f.dataset.filter; renderFilters(); renderShopGrid(); }
});

/* ---------------- ROUTER ---------------- */
const validPages = Array.from(document.querySelectorAll('section[data-page]')).map(s => s.dataset.page);
const cartFlowPages = ['cart','checkout','confirmation'];
const authRequiredPages = ['checkout','orders']; // require sign-in — see pendingRedirect above
const pageTitles = {
  home:"Home", shop:"Shop", about:"About Us", how:"How It Works",
  sustainability:"Sustainability", contact:"Contact Us", cart:"Your Cart",
  login:"Log In", orders:"My Orders", checkout:"Checkout", confirmation:"Order Placed"
};

function renderPage(page){
  if(!validPages.includes(page)) page = 'home';
  if(authRequiredPages.includes(page) && !currentUser){
    pendingRedirect = page;
    showToast("Please log in to continue");
    page = 'login';
  }

  document.querySelectorAll('section[data-page]').forEach(s=>{
    s.classList.toggle('active', s.dataset.page === page);
  });
  document.querySelectorAll('nav.links button[data-nav]').forEach(b=>{
    const isActive = b.dataset.nav === page;
    b.classList.toggle('active', isActive);
    if(isActive) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current');
  });
  document.getElementById('cartNavBtn').classList.toggle('active', cartFlowPages.includes(page));
  document.getElementById('loginNavBtn').classList.toggle('active', page === 'login');

  closeMobileMenu();
  window.scrollTo({top:0, behavior:'instant' in document.documentElement.style ? 'instant' : 'auto'});
  document.title = pageTitles[page] ? `${pageTitles[page]} — Kieke's Pukies` : "Kieke's Pukies";

  if(page === 'shop'){ renderFilters(); renderShopGrid(); }
  if(page === 'cart'){ renderCartPage(); }
  if(page === 'checkout'){ renderCheckoutSummary(); }
  if(page === 'confirmation'){ renderConfirmation(); }
  if(page === 'login'){ renderAuthBox(); }
  if(page === 'orders'){ renderOrdersPage(); }
}

/* goTo updates the URL hash (so browser back/forward and bookmarks work);
   the hashchange listener is what actually renders the page (and applies
   the same login gate, since renderPage checks authRequiredPages too). */
function goTo(page){
  if(!validPages.includes(page)) page = 'home';
  if(location.hash.slice(1) === page){
    renderPage(page);
  } else {
    location.hash = page;
  }
}

window.addEventListener('hashchange', ()=>{
  renderPage(location.hash.slice(1) || 'home');
});

document.addEventListener('click', e=>{
  const nav = e.target.closest('[data-nav]');
  if(nav){ e.preventDefault(); goTo(nav.dataset.nav); }
});

/* ---------------- MOBILE MENU ---------------- */
const hamburgerBtn = document.getElementById('hamburger');
const navLinksEl = document.getElementById('navLinks');

function openMobileMenu(){
  navLinksEl.classList.add('open');
  hamburgerBtn.classList.add('open');
  hamburgerBtn.setAttribute('aria-expanded','true');
  hamburgerBtn.setAttribute('aria-label','Close menu');
  document.body.classList.add('nav-open');
}
function closeMobileMenu(){
  navLinksEl.classList.remove('open');
  hamburgerBtn.classList.remove('open');
  hamburgerBtn.setAttribute('aria-expanded','false');
  hamburgerBtn.setAttribute('aria-label','Open menu');
  document.body.classList.remove('nav-open');
}
hamburgerBtn.addEventListener('click', ()=>{
  navLinksEl.classList.contains('open') ? closeMobileMenu() : openMobileMenu();
});
document.getElementById('navBackdrop').addEventListener('click', closeMobileMenu);
document.addEventListener('keydown', e=>{
  if(e.key === 'Escape' && navLinksEl.classList.contains('open')){
    closeMobileMenu();
    hamburgerBtn.focus();
  }
});

/* ---------------- INIT ---------------- */
(async () => {
  await loadProducts();
  renderHomeFeatured();

  const initialPage = location.hash.slice(1) || 'home';
  if(authRequiredPages.includes(initialPage)){
    // Wait for Supabase to restore any existing session first, so a signed-in
    // user reloading straight into #checkout or #orders isn't bounced to
    // login just because currentUser hasn't been set yet.
    const { data } = await supabaseClient.auth.getSession();
    currentUser = mapSupabaseUser(data.session?.user);
    updateLoginNav();
    if(currentUser) subscribeOrdersRealtime();
  }
  renderPage(initialPage);
})();
