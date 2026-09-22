/* ---------------- TOAST ---------------- */
function showToast(msg){
  const t = document.getElementById('adminToast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._h);
  showToast._h = setTimeout(()=> t.classList.remove('show'), 2200);
}

function money(n){ return "$" + Number(n).toFixed(2); }

/* ---------------- AUTH GATE ---------------- */
let currentAdmin = null; // {id, email, name, avatar} once confirmed as admin

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
    const container = document.getElementById('adminGoogleBtn');
    container.innerHTML = '';
    google.accounts.id.renderButton(container, {
      type:'standard', theme:'outline', size:'large', shape:'pill', text:'signin_with', width:280
    });
  });
}

async function handleGoogleCredentialResponse(response){
  const { error } = await supabaseClient.auth.signInWithIdToken({
    provider: 'google',
    token: response.credential
  });
  if(error) showToast("Sign-in failed — try again");
}

async function checkAdminAndEnter(session){
  const gateWrap = document.getElementById('gateWrap');
  const gateDenied = document.getElementById('gateDenied');
  const gateMsg = document.getElementById('gateMsg');
  const googleBtnWrap = document.getElementById('adminGoogleBtn');
  const shell = document.getElementById('adminShell');

  if(!session){
    shell.classList.remove('active');
    gateWrap.style.display = 'flex';
    gateDenied.classList.remove('active');
    googleBtnWrap.style.display = 'flex';
    gateMsg.textContent = "Admin sign-in required.";
    renderGoogleButton();
    return;
  }

  const { data: isAdmin, error } = await supabaseClient.rpc('is_admin');
  if(error){ console.error(error); }

  if(!isAdmin){
    shell.classList.remove('active');
    gateWrap.style.display = 'flex';
    googleBtnWrap.style.display = 'none';
    gateMsg.textContent = `Signed in as ${session.user.email}.`;
    gateDenied.classList.add('active');
    currentAdmin = null;
    return;
  }

  const meta = session.user.user_metadata || {};
  currentAdmin = {
    id: session.user.id,
    email: session.user.email,
    name: meta.full_name || meta.name || null,
    avatar: meta.avatar_url || meta.picture || null
  };
  document.getElementById('adminWhoEmail').textContent = currentAdmin.email;
  document.getElementById('gateWrap').style.display = 'none';
  shell.classList.add('active');

  initAdminData();
}

document.getElementById('gateSignOutBtn').addEventListener('click', async ()=>{
  await supabaseClient.auth.signOut();
});
document.getElementById('adminSignOutBtn').addEventListener('click', async ()=>{
  await supabaseClient.auth.signOut();
});

supabaseClient.auth.onAuthStateChange((_event, session)=>{
  checkAdminAndEnter(session);
});

/* ---------------- TABS ---------------- */
document.querySelectorAll('.admin-nav-btn[data-tab]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.admin-nav-btn[data-tab]').forEach(b=>b.classList.toggle('active', b===btn));
    document.querySelectorAll('.admin-tabs[data-tab]').forEach(s=>s.classList.toggle('active', s.dataset.tab===btn.dataset.tab));
    if(btn.dataset.tab === 'dashboard') loadDashboard();
    if(btn.dataset.tab === 'products') loadProductsTab();
    if(btn.dataset.tab === 'orders') loadOrdersTab();
    if(btn.dataset.tab === 'users') loadUsersTab();
  });
});

let dataLoadedOnce = false;
function initAdminData(){
  if(dataLoadedOnce) return;
  dataLoadedOnce = true;
  loadDashboard();
}

/* ================= DASHBOARD ================= */
async function loadDashboard(){
  const statGrid = document.getElementById('statGrid');
  statGrid.innerHTML = `<p style="color:var(--ink-soft);">Loading…</p>`;

  const [ordersRes, productsRes, usersRes] = await Promise.all([
    supabaseClient.from('orders').select('id, total, status, created_at, order_number, customer_name').order('created_at', {ascending:false}),
    supabaseClient.from('products').select('id', {count:'exact', head:true}).eq('active', true),
    supabaseClient.from('profiles').select('id', {count:'exact', head:true})
  ]);

  const orders = ordersRes.data || [];
  const revenue = orders.reduce((s,o)=> s + Number(o.total || 0), 0);
  const pending = orders.filter(o => o.status !== 'delivered').length;

  statGrid.innerHTML = `
    <div class="stat-card"><div class="num">${orders.length}</div><div class="lbl">Total Orders</div></div>
    <div class="stat-card"><div class="num">${pending}</div><div class="lbl">Pending Orders</div></div>
    <div class="stat-card"><div class="num">${money(revenue)}</div><div class="lbl">Total Revenue</div></div>
    <div class="stat-card"><div class="num">${productsRes.count ?? '—'}</div><div class="lbl">Active Products</div></div>
    <div class="stat-card"><div class="num">${usersRes.count ?? '—'}</div><div class="lbl">Customers</div></div>
  `;

  const recent = orders.slice(0, 8);
  const table = document.getElementById('recentOrdersTable');
  if(recent.length === 0){
    table.innerHTML = `<tr><td style="color:var(--ink-soft);">No orders yet.</td></tr>`;
    return;
  }
  table.innerHTML = `
    <tr><th>Order</th><th>Customer</th><th>Status</th><th>Total</th><th>Date</th></tr>
    ${recent.map(o=>`
      <tr>
        <td>${o.order_number}</td>
        <td>${o.customer_name}</td>
        <td>${statusBadge(o.status)}</td>
        <td>${money(o.total)}</td>
        <td>${new Date(o.created_at).toLocaleDateString()}</td>
      </tr>
    `).join('')}
  `;
}

function statusBadge(status){
  const labels = {placed:'Placed', preparing:'Preparing', out_for_delivery:'Out for Delivery', delivered:'Delivered'};
  const cls = status === 'delivered' ? 'badge-active' : 'badge-inactive';
  return `<span class="admin-badge ${cls}">${labels[status] || status}</span>`;
}

/* ================= PRODUCTS ================= */
let editingProductId = null;

function buildIconPicker(selected){
  const grid = document.getElementById('iconPickGrid');
  grid.innerHTML = Object.keys(icons).map(key => `
    <div class="icon-pick ${key===selected?'selected':''}" data-icon="${key}" title="${key}">${icons[key]}</div>
  `).join('');
  grid.querySelectorAll('.icon-pick').forEach(el=>{
    el.addEventListener('click', ()=>{
      grid.querySelectorAll('.icon-pick').forEach(x=>x.classList.remove('selected'));
      el.classList.add('selected');
    });
  });
}
function getSelectedIcon(){
  const el = document.querySelector('#iconPickGrid .icon-pick.selected');
  return el ? el.dataset.icon : Object.keys(icons)[0];
}

function openProductForm(product){
  editingProductId = product ? product.id : null;
  document.getElementById('productForm').classList.add('active');
  document.getElementById('pfSubmitBtn').textContent = product ? 'Update Product' : 'Add Product';
  document.getElementById('pfName').value = product ? product.name : '';
  document.getElementById('pfCategory').value = product ? product.category : '';
  document.getElementById('pfPrice').value = product ? product.price : '';
  document.getElementById('pfDesc').value = product ? product.description : '';
  document.getElementById('pfActive').checked = product ? product.active : true;
  buildIconPicker(product ? product.icon : Object.keys(icons)[0]);
  document.getElementById('productForm').scrollIntoView({behavior:'smooth', block:'nearest'});
}
function closeProductForm(){
  editingProductId = null;
  document.getElementById('productForm').classList.remove('active');
  document.getElementById('productForm').reset();
}

document.getElementById('addProductBtn').addEventListener('click', ()=> openProductForm(null));
document.getElementById('pfCancelBtn').addEventListener('click', closeProductForm);

document.getElementById('productForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const payload = {
    name: document.getElementById('pfName').value.trim(),
    category: document.getElementById('pfCategory').value.trim(),
    price: Number(document.getElementById('pfPrice').value),
    description: document.getElementById('pfDesc').value.trim(),
    icon: getSelectedIcon(),
    active: document.getElementById('pfActive').checked
  };

  let error;
  if(editingProductId){
    ({ error } = await supabaseClient.from('products').update(payload).eq('id', editingProductId));
  } else {
    ({ error } = await supabaseClient.from('products').insert(payload));
  }

  if(error){ showToast("Couldn't save product"); console.error(error); return; }
  showToast(editingProductId ? "Product updated" : "Product added");
  closeProductForm();
  loadProductsTab();
});

async function loadProductsTab(){
  const table = document.getElementById('productsTable');
  table.innerHTML = `<tr><td style="color:var(--ink-soft);">Loading…</td></tr>`;
  const { data, error } = await supabaseClient.from('products').select('*').order('id');

  // keep the category datalist fresh for the form
  const cats = [...new Set((data||[]).map(p=>p.category))];
  document.getElementById('catList').innerHTML = cats.map(c=>`<option value="${c}">`).join('');

  if(error){ table.innerHTML = `<tr><td style="color:var(--ink-soft);">Couldn't load products.</td></tr>`; console.error(error); return; }
  if(!data || data.length === 0){ table.innerHTML = `<tr><td style="color:var(--ink-soft);">No products yet — add your first one above.</td></tr>`; return; }

  table.innerHTML = `
    <tr><th></th><th>Name</th><th>Category</th><th>Price</th><th>Status</th><th></th></tr>
    ${data.map(p=>`
      <tr>
        <td class="admin-icon-cell">${icons[p.icon] || ''}</td>
        <td>${p.name}</td>
        <td>${p.category}</td>
        <td>${money(p.price)}</td>
        <td><span class="admin-badge ${p.active?'badge-active':'badge-inactive'}">${p.active?'Active':'Hidden'}</span></td>
        <td class="row-actions">
          <button data-edit="${p.id}">Edit</button>
          <button data-delete="${p.id}" class="danger">Delete</button>
        </td>
      </tr>
    `).join('')}
  `;

  table.querySelectorAll('[data-edit]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const p = data.find(x=>String(x.id)===btn.dataset.edit);
      if(p) openProductForm(p);
    });
  });
  table.querySelectorAll('[data-delete]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      if(!confirm("Delete this product? This can't be undone.")) return;
      const { error } = await supabaseClient.from('products').delete().eq('id', btn.dataset.delete);
      if(error){ showToast("Couldn't delete product"); console.error(error); return; }
      showToast("Product deleted");
      loadProductsTab();
    });
  });
}

/* ================= ORDERS ================= */
const ORDER_STATUSES = [
  {key:'placed', label:'Placed'},
  {key:'preparing', label:'Preparing'},
  {key:'out_for_delivery', label:'Out for Delivery'},
  {key:'delivered', label:'Delivered'}
];
let orderFilter = 'all';

function buildOrderFilterPills(){
  const wrap = document.getElementById('orderFilterPills');
  const options = [{key:'all', label:'All'}, ...ORDER_STATUSES];
  wrap.innerHTML = options.map(o=>`<button class="filter-pill ${orderFilter===o.key?'active':''}" data-status-filter="${o.key}">${o.label}</button>`).join('');
  wrap.querySelectorAll('[data-status-filter]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      orderFilter = btn.dataset.statusFilter;
      loadOrdersTab();
    });
  });
}

async function loadOrdersTab(){
  buildOrderFilterPills();
  const table = document.getElementById('ordersTable');
  table.innerHTML = `<tr><td style="color:var(--ink-soft);">Loading…</td></tr>`;

  let query = supabaseClient.from('orders').select('*').order('created_at', {ascending:false});
  if(orderFilter !== 'all') query = query.eq('status', orderFilter);
  const { data, error } = await query;

  if(error){ table.innerHTML = `<tr><td style="color:var(--ink-soft);">Couldn't load orders.</td></tr>`; console.error(error); return; }
  if(!data || data.length === 0){ table.innerHTML = `<tr><td style="color:var(--ink-soft);">No orders here yet.</td></tr>`; return; }

  table.innerHTML = `
    <tr><th>Order</th><th>Customer</th><th>City</th><th>Total</th><th>Date</th><th>Status</th></tr>
    ${data.map(o=>`
      <tr>
        <td>${o.order_number}</td>
        <td>${o.customer_name}</td>
        <td>${o.city}</td>
        <td>${money(o.total)}</td>
        <td>${new Date(o.created_at).toLocaleDateString()}</td>
        <td>
          <select class="status-select" data-order-id="${o.id}">
            ${ORDER_STATUSES.map(s=>`<option value="${s.key}" ${s.key===o.status?'selected':''}>${s.label}</option>`).join('')}
          </select>
        </td>
      </tr>
    `).join('')}
  `;

  table.querySelectorAll('.status-select').forEach(sel=>{
    sel.addEventListener('change', async ()=>{
      const { error } = await supabaseClient.from('orders').update({status: sel.value}).eq('id', sel.dataset.orderId);
      if(error){ showToast("Couldn't update status"); console.error(error); return; }
      showToast("Order status updated");
    });
  });
}

/* ================= USERS ================= */
async function loadUsersTab(){
  const table = document.getElementById('usersTable');
  table.innerHTML = `<tr><td style="color:var(--ink-soft);">Loading…</td></tr>`;

  const [profilesRes, ordersRes] = await Promise.all([
    supabaseClient.from('profiles').select('*').order('created_at', {ascending:false}),
    supabaseClient.from('orders').select('user_id')
  ]);

  if(profilesRes.error){ table.innerHTML = `<tr><td style="color:var(--ink-soft);">Couldn't load users.</td></tr>`; console.error(profilesRes.error); return; }

  const orderCounts = {};
  (ordersRes.data || []).forEach(o=>{ orderCounts[o.user_id] = (orderCounts[o.user_id] || 0) + 1; });

  const profiles = profilesRes.data || [];
  if(profiles.length === 0){ table.innerHTML = `<tr><td style="color:var(--ink-soft);">No registered customers yet.</td></tr>`; return; }

  table.innerHTML = `
    <tr><th></th><th>Name</th><th>Email</th><th>Orders</th><th>Joined</th></tr>
    ${profiles.map(p=>{
      const initial = (p.full_name || p.email || '?').trim()[0].toUpperCase();
      return `
        <tr>
          <td>${p.avatar_url ? `<img class="admin-avatar" src="${p.avatar_url}">` : `<span class="admin-avatar-fallback">${initial}</span>`}</td>
          <td>${p.full_name || '—'}</td>
          <td>${p.email}</td>
          <td>${orderCounts[p.id] || 0}</td>
          <td>${new Date(p.created_at).toLocaleDateString()}</td>
        </tr>
      `;
    }).join('')}
  `;
}
