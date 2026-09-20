import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, getIdTokenResult } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore, collection, doc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

  // TODO: Add SDKs for Firebase products that you want to use

  // https://firebase.google.com/docs/web/setup#available-libraries

  const firebaseConfig = {
    apiKey: "AIzaSyCXxXtsZLtWhSM6osnNpwq-NKcjAu972o4",
    authDomain: "assembly-line-app-8a20c.firebaseapp.com",
    projectId: "assembly-line-app-8a20c",
    storageBucket: "assembly-line-app-8a20c.firebasestorage.app",
    messagingSenderId: "590913672092",
    appId: "1:590913672092:web:0baaa0f222454aa8e12e59",
    measurementId: "G-H0SL12596X"
  };
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app, 'default');
let currentUser = null;

// ════════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════════
const S = {
  products: [],
  kits: [],
  activeTab: 'products',
  nextProdId: 166,
  nextKitId: 36,
  _productSearch: '',
  _pkgSearch: '',
  _editKitId: null,
  _kitColours: ['#2471A3','#D35400','#6C3483','#1E8449','#B7770D','#17A589','#C0392B','#2E4057','#117A65','#6E2F1A'],
  _selColour: '#2471A3',
};

// Data is loaded from CSVs in /db during startup.
const PM_CODE_MAP = {};
const MASTER_NAME_MAP = {};
S.packaging = [];
S.rmItems = [];
const KIT_MATERIALS = {};

// ════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════
const getProd = code => S.products.find(p => p.code == code);
const normKey = value => (value || '').toString().trim().toLowerCase();
const getKit  = id   => S.kits.find(k => k.id === id);
const N = x  => Number(x).toLocaleString('en-IN');
const fmtD   = () => new Date().toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'});

function consumed(productCode) {
  let total = 0;
  S.kits.forEach(k => k.items.filter(it => it.productCode == productCode).forEach(it => total += it.pcs * k.orderQty));
  return total;
}
function remaining(productCode) {
  const p = getProd(productCode);
  return p ? p.stock - consumed(productCode) : 0;
}
function remStatus(rem) {
  if (rem < 0) return 'danger';
  if (rem === 0) return 'zero';
  return 'ok';
}
function remClass(rem) { return rem < 0 ? 'row-danger' : rem === 0 ? 'row-warn' : ''; }

// Packaging consumed: total pcs used across all kits for a given PM code
function consumedPkgByCode(pmCode) {
  if (!pmCode) return 0;
  let total = 0;
  S.kits.forEach(k => {
    const mats = KIT_MATERIALS[k.id];
    if (!mats) return;
    mats.pkg.forEach(p => {
      if (p.pmCode === pmCode) total += Math.ceil(k.orderQty / 6) * p.qtyPer6;
    });
  });
  return total;
}
// RM consumed: returns {kg, pcs} — only one will be non-zero
function consumedRMByCode(rmCode) {
  if (!rmCode) return {kg:0, pcs:0};
  let kg = 0, pcs = 0;
  S.kits.forEach(k => {
    const mats = KIT_MATERIALS[k.id];
    if (!mats) return;
    mats.rm.forEach(r => {
      if (r.rmCode === rmCode) {
        const lots = Math.ceil(k.orderQty / 6);
        if (r.unit === 'gms') kg += lots * r.qtyPer6 * r.gmsEach / 1000;
        else pcs += lots * r.qtyPer6;
      }
    });
  });
  return {kg, pcs};
}
// Remaining packaging stock after kit consumption
function remainingPkg(p) { return p.stock - consumedPkgByCode(p.code); }
// Remaining RM stock after kit consumption (returns KG or pcs depending on item)
function remainingRM(r) {
  const c = consumedRMByCode(r.code);
  return r.code && r.code.startsWith('RM') ? r.qtyKg - c.kg : r.qtyKg - c.pcs;
}

function resolveMasterItem(items, code, name) {
  if (code) {
    const byCode = items.find(item => item.code === code);
    if (byCode) return byCode;
  }
  const key = normKey(name);
  if (key && MASTER_NAME_MAP[key]) return MASTER_NAME_MAP[key];
  return null;
}

// ════════════════════════════════════════════════════
// TOAST
// ════════════════════════════════════════════════════
function toast(msg, type='success') {
  const box = document.getElementById('toastBox');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${{success:'✅',error:'❌',warning:'⚠️'}[type]||'✅'}</span>${msg}`;
  box.appendChild(el);
  setTimeout(()=>{el.style.opacity='0';el.style.transition='opacity .4s';setTimeout(()=>el.remove(),400);}, 3000);
}

// ════════════════════════════════════════════════════
// NAV
// ════════════════════════════════════════════════════
function renderNav() {
  const nav = document.getElementById('navBar');
  const dangerCount  = S.products.filter(p => remaining(p.code) < 0).length;
  const urgentProdsCount = S.products.filter(p => {
    const rem = remaining(p.code); const ms = p.minStock || 0;
    return ms > 0 && rem < ms;
  }).length;
  const urgentPkgCount = (S.packaging||[]).filter(p => (p.minQty||0) > 0 && remainingPkg(p) <= p.minQty).length;
  const urgentRMCount  = (S.rmItems||[]).filter(r => (r.minQty||0) > 0 && remainingRM(r) <= r.minQty).length;
  const urgentCount = urgentProdsCount + urgentPkgCount + urgentRMCount;
  nav.innerHTML = `<div class="ntab${S.activeTab==='products'?' active':''}" onclick="switchTab('products')">📋 Products</div>` +
    `<div class="ntab${S.activeTab==='packaging'?' active':''}" onclick="switchTab('packaging')" style="color:${S.activeTab==='packaging'?'#6C3483':''};">📦 Packaging</div>` +
    `<div class="ntab${S.activeTab==='rm'?' active':''}" onclick="switchTab('rm')" style="color:${S.activeTab==='rm'?'#B7770D':''};">🧪 Raw Materials</div>` +
    `<div class="ntab ntab-urgent${S.activeTab==='urgent'?' active':''}" onclick="switchTab('urgent')" style="font-weight:800;">
      🚨 Urgent Order ${urgentCount>0?`<span class="badge b-danger" style="font-size:10px;">${urgentCount}</span>`:'<span class="badge b-gray" style="font-size:10px;">0</span>'}
    </div>` +
    `<div class="nav-sep"></div>` +
    S.kits.map(k =>
      `<div class="ntab${S.activeTab===k.id?' active':''}" onclick="switchTab('${k.id}')" style="color:${S.activeTab===k.id?k.colour:''};">
        <span style="width:9px;height:9px;border-radius:50%;background:${k.colour};display:inline-block;flex-shrink:0;"></span>
        ${k.short}
      </div>`
    ).join('') +
    `<div class="nav-sep"></div>` +
    `<div class="ntab ntab-final${S.activeTab==='final'?' active':''}" onclick="switchTab('final')">
      ✅ Final Stock ${dangerCount>0?`<span class="badge b-danger" style="font-size:10px;">${dangerCount} ⚠️</span>`:''}
    </div>` +
    `<div class="ntab ntab-add" onclick="openAddKitModal()">＋ Kit</div>`;
}

// ════════════════════════════════════════════════════
// TAB SWITCHER
// ════════════════════════════════════════════════════
function switchTab(id) {
  S.activeTab = id;
  renderNav();
  renderMain();
}

function renderMain() {
  const el = document.getElementById('mainArea');
  if (S.activeTab === 'products') {
    el.innerHTML = renderProducts();
    if (S._productSearch) filterProducts(S._productSearch);
  } else if (S.activeTab === 'final')  el.innerHTML = renderFinal();
  else if (S.activeTab === 'urgent') el.innerHTML = renderUrgent();
  else if (S.activeTab === 'packaging') el.innerHTML = renderPackaging();
  else if (S.activeTab === 'rm') el.innerHTML = renderRM();
  else {
    const kit = getKit(S.activeTab);
    if (kit) el.innerHTML = renderKit(kit);
    else el.innerHTML = '<p style="padding:40px;color:var(--muted)">Tab not found.</p>';
  }
}

async function persistProduct(product) {
  if (!currentUser) throw new Error('Please sign in again.');
  await setDoc(doc(db, 'products', product._docId || product.code), {
    id: product.id, code: product.code, name: product.name, size: product.size || '', material: product.material || '',
    stock: Number(product.stock) || 0, minStock: Number(product.minStock) || 0, pmCode: product.pmCode || ''
  });
}

async function persistKit(kit) {
  if (!currentUser) throw new Error('Please sign in again.');
  await updateDoc(doc(db, 'kits', kit._docId || kit.id), { name: kit.name, short: kit.short || '', colour: kit.colour, orderQty: Number(kit.orderQty) || 500 });
}

async function persistPackaging(item, previousCode = item._docId || item.code) {
  if (!currentUser) throw new Error('Please sign in again.');
  const data = { code: item.code, name: item.name, stock: Number(item.stock) || 0, kits: item.kits || '', minQty: Number(item.minQty) || 0 };
  await setDoc(doc(db, 'packaging', item.code), data);
  if (previousCode && previousCode !== item.code) await deleteDoc(doc(db, 'packaging', previousCode));
  item._docId = item.code;
}

async function persistRawMaterial(item, previousCode = item._docId || item.code) {
  if (!currentUser) throw new Error('Please sign in again.');
  const data = { code: item.code, name: item.name, qtyKg: Number(item.qtyKg) || 0, minQty: Number(item.minQty) || 0 };
  await setDoc(doc(db, 'rawMaterials', item.code), data);
  if (previousCode && previousCode !== item.code) await deleteDoc(doc(db, 'rawMaterials', previousCode));
  item._docId = item.code;
}

async function persistKitItems(kit) {
  if (!currentUser) throw new Error('Please sign in again.');
  const itemsRef = collection(db, 'kits', kit.id, 'items');
  const existing = await getDocs(itemsRef);
  const batch = writeBatch(db);
  existing.docs.forEach(snapshot => batch.delete(snapshot.ref));
  kit.items.forEach((item, index) => batch.set(doc(itemsRef, `item${String(index + 1).padStart(3, '0')}`), {
    productCode: item.productCode, step: item.step || '', pcs: Number(item.pcs) || 1, section: item.section || 'Main Kit', comment: item.comment || ''
  }));
  await batch.commit();
}

async function persistKitMaterial(kitId, kind, index, material) {
  if (!currentUser) throw new Error('Please sign in again.');
  await setDoc(doc(db, 'kitMaterials', `${kitId}_${kind}_${index}`), {
    kitId, kind, code: kind === 'pkg' ? material.pmCode || '' : material.rmCode || '', name: material.name || '',
    qtyPer6: Number(material.qtyPer6) || 1, unit: material.unit || '', gmsEach: Number(material.gmsEach) || 0
  });
}

async function commitChange(operation, message) {
  try {
    await operation();
    toast(message, 'success');
    renderMain(); renderNav();
  } catch (error) {
    toast(`Could not save change: ${error.message}`, 'error');
  }
}

// ════════════════════════════════════════════════════
// PRODUCTS TAB
// ════════════════════════════════════════════════════
function renderProducts() {
  return `
  <div class="sh">
    <div><div class="sh-title">📋 Products Master</div>
    <div class="sh-sub">All ${S.products.length} products — add, edit or update current stock quantities</div></div>
  </div>
  <div class="card" style="margin-bottom:16px;">
    <div class="card-hdr">Add New Product <span style="font-size:12px;font-weight:500;color:var(--muted);margin-left:8px;">${S.products.length} / 1000 products</span></div>
    <div class="pform">
      <div class="pform-group"><label>Product Code *</label><input class="inp" id="newCode" placeholder="e.g. 42"></div>
      <div class="pform-group"><label>Product Name *</label><input class="inp" id="newName" placeholder="Full product name" onkeydown="if(event.key==='Enter')addProduct()"></div>
      <div class="pform-group"><label>Size</label><input class="inp" id="newSize" placeholder="e.g. 1 gm, 10 ml"></div>
      <div class="pform-group"><label>Material / Packaging</label><input class="inp" id="newMat" placeholder="e.g. Amp, Bottle"></div>
      <div class="pform-group" style="min-width:130px;"><label>Current Stock *</label><input type="number" class="inp" id="newStock" placeholder="e.g. 10000" min="0" onkeydown="if(event.key==='Enter')addProduct()"></div>
      <div class="pform-group" style="min-width:120px;"><label>Min Stock</label><input type="number" class="inp" id="newMinStock" placeholder="e.g. 2000" min="0" onkeydown="if(event.key==='Enter')addProduct()"></div>
      <button class="btn btn-accent" style="align-self:flex-end;" onclick="addProduct()">➕ Add</button>
    </div>
  </div>
  <div class="card" style="margin-bottom:12px;padding:14px 18px;">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <span style="font-size:18px;flex-shrink:0;">🔍</span>
      <div style="position:relative;flex:1;min-width:220px;max-width:460px;">
        <input type="text" class="inp" id="prodSearch"
          placeholder="Search by product name or code…"
          style="width:100%;padding-right:32px;"
          oninput="filterProducts(this.value)"
          value="${(S._productSearch||'').replace(/"/g,'&quot;')}"
          autocomplete="off">
        <button id="prodSearchClear" onclick="clearProdSearch()"
          style="position:absolute;right:7px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--muted);font-size:15px;padding:0;line-height:1;display:${S._productSearch?'block':'none'};"
          title="Clear search">✕</button>
      </div>
      <span id="prodSearchCount" style="color:var(--muted);font-size:12.5px;white-space:nowrap;">
        ${S._productSearch ? '' : S.products.length+' products'}
      </span>
    </div>
  </div>
  <div class="card" style="overflow:visible;">
    <div class="prod-table-wrap">
      <table>
        <thead><tr>
          <th style="width:40px;text-align:center;">#</th>
          <th>PM Code</th><th>Product Name</th><th>Size</th><th>Material</th>
          <th>Current Stock</th><th>Min Stock</th><th>Consumed</th><th>Remaining</th><th>Actions</th>
        </tr></thead>
        <tbody id="prodTableBody">
          ${S.products.map((p, idx) => {
            const cons    = consumed(p.code);
            const rem     = p.stock - cons;
            const minSt   = p.minStock || 0;
            const urgent  = minSt > 0 && rem >= 0 && rem < minSt;
            const st      = rem < 0 ? 'danger' : rem === 0 ? 'warn' : urgent ? 'urgent' : 'ok';
            const barPct  = p.stock > 0 ? Math.max(0, Math.min(100, Math.round((rem/p.stock)*100))) : 0;
            const barCol  = st==='danger'?'var(--danger)':st==='warn'?'var(--warn)':st==='urgent'?'var(--danger)':'var(--ok)';
            const rowCls  = st==='danger'?'row-danger':st==='warn'?'row-warn':st==='urgent'?'row-urgent':'';
            return `<tr class="${rowCls}">
              <td style="text-align:center;font-size:12px;color:var(--muted);font-weight:700;width:40px;">${idx+1}</td>
              <td data-code="${p.code}" style="white-space:nowrap;" id="pmCodeCell_${p.id}">
                <div class="editable-cell" onclick="editPMCode(${p.id})" title="Click to edit PM code">
                  ${p.pmCode ? `<span class="code-pill" style="font-size:11px;letter-spacing:0;">${p.pmCode}</span>` : `<span class="code-pill">${p.code}</span>`}
                  <span class="edit-hint">✏️</span>
                </div>
                <div style="font-size:10px;color:var(--muted);margin-top:2px;">#${p.code}</div>
              </td>
              <td id="nameCell_${p.id}" data-name="${p.name.toLowerCase().replace(/"/g,'&quot;')}" style="font-weight:600;max-width:260px;">
                <div class="editable-cell" onclick="editName(${p.id})" title="Click to edit name">
                  <span>${p.name}</span><span class="edit-hint">✏️</span>
                </div>
              </td>
              <td id="sizeCell_${p.id}" style="color:var(--text2);">
                <div class="editable-cell" onclick="editSize(${p.id})" title="Click to edit size">
                  <span>${p.size||'—'}</span><span class="edit-hint">✏️</span>
                </div>
              </td>
              <td id="matCell_${p.id}" style="color:var(--text2);">
                <div class="editable-cell" onclick="editMat(${p.id})" title="Click to edit material">
                  <span>${p.material||'—'}</span><span class="edit-hint">✏️</span>
                </div>
              </td>
              <td>
                <div id="stockCell_${p.id}">
                  <div style="font-weight:700;font-size:14px;">${N(p.stock)}</div>
                  <div class="pbar-wrap"><div class="pbar" style="width:${barPct}%;background:${barCol};"></div></div>
                </div>
              </td>
              <td>
                <div id="minStockCell_${p.id}">
                  ${minSt > 0
                    ? `<span class="badge ${urgent||rem<0?'b-danger':'b-gray'}" style="font-size:12px;">${urgent||rem<0?'🔔 ':''} ${N(minSt)}</span>`
                    : `<span style="color:var(--muted);font-size:12px;">—</span>`}
                  <button class="btn btn-outline btn-xs" style="margin-top:3px;display:block;" onclick="editMinStock(${p.id})">✏️</button>
                </div>
              </td>
              <td style="color:var(--text2);font-weight:600;">${cons>0?'−'+N(cons):'—'}</td>
              <td><span class="badge ${st==='danger'?'b-danger':st==='warn'?'b-warn':st==='urgent'?'b-danger':'b-ok'}" style="font-size:12.5px;font-weight:800;">
                ${(st==='danger'||st==='urgent')?'⚠️ ':''} ${rem<0?'−'+N(Math.abs(rem)):N(rem)}
              </span></td>
              <td>
                <div style="display:flex;gap:6px;flex-wrap:wrap;">
                  <button class="btn btn-outline btn-sm btn-xs" onclick="editStock(${p.id})">✏️ Stock</button>
                  <button class="btn btn-danger btn-xs" onclick="deleteProd(${p.id})">🗑️</button>
                </div>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  </div>`;
}

// ════════════════════════════════════════════════════
// PACKAGING TAB
// ════════════════════════════════════════════════════
function renderPackaging() {
  const pkgSearch = (S._pkgSearch || '').toLowerCase();
  const filtered = pkgSearch
    ? S.packaging.filter(p => p.name.toLowerCase().includes(pkgSearch) || p.code.toLowerCase().includes(pkgSearch) || (p.kits||'').toLowerCase().includes(pkgSearch))
    : S.packaging;

  const kitLinks = item => {
    if (!item.kits) return '<span style="color:var(--muted);font-size:12px;">—</span>';
    return item.kits.split(',').map(k => k.trim()).filter(Boolean)
      .map(k => `<span class="badge b-gray" style="font-size:11px;margin:1px 2px;">${k}</span>`).join('');
  };

  return `
  <div class="sh">
    <div><div class="sh-title">📦 Packaging</div>
    <div class="sh-sub">${S.packaging.length} packaging items — boxes, trays, sleeves, monocartons</div></div>
  </div>
  <div class="card" style="margin-bottom:12px;padding:14px 18px;">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <span style="font-size:18px;flex-shrink:0;">🔍</span>
      <div style="position:relative;flex:1;min-width:220px;max-width:460px;">
        <input type="text" class="inp" id="pkgSearch"
          placeholder="Search by code, name or kit…"
          style="width:100%;padding-right:32px;"
          oninput="pkgSearchInputChanged(this)"
          value="${(S._pkgSearch||'').replace(/"/g,'&quot;')}"
          autocomplete="off">
        ${S._pkgSearch?`<button onclick="clearPkgSearch()" style="position:absolute;right:7px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--muted);font-size:15px;padding:0;">✕</button>`:''}
      </div>
      <span style="color:var(--muted);font-size:12.5px;white-space:nowrap;">${pkgSearch?filtered.length+' of '+S.packaging.length+' shown':S.packaging.length+' items'}</span>
    </div>
  </div>
  <div class="card" style="overflow:visible;">
    <div class="prod-table-wrap">
      <table>
        <thead><tr>
          <th>Item Code</th><th>Item Name</th><th style="text-align:right;">Current Stock</th><th style="text-align:right;">Used by Kits</th><th style="text-align:right;">Remaining</th><th style="text-align:right;">Min Qty</th><th style="text-align:right;">Status</th><th>Linked Kits</th><th>Actions</th>
        </tr></thead>
        <tbody>
          ${filtered.map(p => {
            const id  = p._pkgId;
            const mq  = p.minQty || 0;
            const cons = consumedPkgByCode(p.code);
            const rem  = p.stock - cons;
            const urgent = mq > 0 && rem <= mq;
            const zero   = rem <= 0;
            const rowCls = rem < 0 ? 'row-danger' : urgent ? 'row-warn' : '';
            const statusBadge = rem < 0
              ? `<span class="badge b-danger" style="font-size:11.5px;">🔴 Deficit</span>`
              : urgent
                ? `<span class="badge b-warn" style="font-size:11.5px;">⚠️ Low</span>`
                : rem === 0
                  ? `<span class="badge b-warn" style="font-size:11.5px;">⚠️ Zero</span>`
                  : `<span class="badge b-ok" style="font-size:11.5px;">✅ OK</span>`;
            return `<tr class="${rowCls}">
              <td id="pkgCodeCell_${id}">
                <div class="editable-cell" onclick="editPkgCode(${id})" title="Click to edit PM code">
                  <span class="code-pill" style="font-size:11px;">${p.code||'—'}</span>
                  <span class="edit-hint">✏️</span>
                </div>
              </td>
              <td style="font-weight:600;max-width:300px;">${p.name}</td>
              <td style="text-align:right;" id="pkgStockCell_${id}">
                <div style="font-weight:700;font-size:14px;">${N(p.stock)}</div>
              </td>
              <td style="text-align:right;color:${cons>0?'var(--danger)':'var(--muted)'};">
                ${cons > 0 ? `<span style="font-weight:700;">−${N(cons)}</span>` : '<span style="font-size:12px;">—</span>'}
              </td>
              <td style="text-align:right;">
                <span class="badge ${rem<0?'b-danger':rem===0?'b-warn':'b-ok'}" style="font-size:13px;font-weight:800;">
                  ${rem < 0 ? '−'+N(Math.abs(rem)) : N(rem)}
                </span>
              </td>
              <td style="text-align:right;" id="pkgMinCell_${id}">
                ${mq > 0
                  ? `<span class="badge ${urgent?'b-danger':'b-gray'}" style="font-size:12px;">${urgent?'🔔 ':''}${N(mq)}</span>`
                  : `<span style="color:var(--muted);font-size:12px;">—</span>`}
              </td>
              <td style="text-align:right;">${statusBadge}</td>
              <td style="min-width:180px;">${kitLinks(p)}</td>
              <td>
                <div style="display:flex;gap:5px;flex-wrap:wrap;">
                  <button class="btn btn-outline btn-xs" onclick="editPkgStock(${id})">✏️ Stock</button>
                  <button class="btn btn-outline btn-xs" onclick="editPkgMin(${id})">✏️ Min</button>
                </div>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  </div>`;
}

// ════════════════════════════════════════════════════
// RAW MATERIALS TAB
// ════════════════════════════════════════════════════
function renderRM() {
  const totalKg = S.rmItems.reduce((a,r) => a + (r.qtyKg||0), 0);
  const totalGm = totalKg * 1000;
  return `
  <div class="sh">
    <div><div class="sh-title">🧪 Raw Materials</div>
    <div class="sh-sub">${S.rmItems.length} raw materials — sodium alginates & mask sheets</div></div>
  </div>
  <div class="card" style="overflow:visible;">
    <div class="prod-table-wrap">
      <table>
        <thead><tr>
          <th>RM Code</th><th>Material Name</th><th style="text-align:right;">Qty (KG)</th><th style="text-align:right;">Used by Kits</th><th style="text-align:right;">Remaining</th><th style="text-align:right;">Min Qty (KG)</th><th style="text-align:right;">Status</th><th>Actions</th>
        </tr></thead>
        <tbody>
          ${S.rmItems.map(r => {
            const id   = r._rmId;
            const mq   = r.minQty || 0;
            const cons = consumedRMByCode(r.code);
            const consKg = r.code && r.code.startsWith('RM') ? cons.kg : cons.pcs;
            const rem  = r.qtyKg - consKg;
            const urgent = mq > 0 && rem <= mq;
            const zero   = rem <= 0;
            const rowCls = rem < 0 ? 'row-danger' : urgent ? 'row-warn' : '';
            const statusBadge = rem < 0
              ? `<span class="badge b-danger" style="font-size:11.5px;">🔴 Deficit</span>`
              : urgent
                ? `<span class="badge b-warn" style="font-size:11.5px;">⚠️ Low</span>`
                : rem === 0
                  ? `<span class="badge b-warn" style="font-size:11.5px;">⚠️ Zero</span>`
                  : `<span class="badge b-ok" style="font-size:11.5px;">✅ OK</span>`;
            const isKg = r.code && r.code.startsWith('RM');
            return `<tr class="${rowCls}">
              <td id="rmCodeCell_${id}">
                <div class="editable-cell" onclick="editRMCode(${id})" title="Click to edit RM code">
                  ${r.code ? `<span class="code-pill" style="font-size:11px;">${r.code}</span>` : '<span style="color:var(--muted)">—</span>'}
                  <span class="edit-hint">✏️</span>
                </div>
              </td>
              <td style="font-weight:600;">${r.name}</td>
              <td style="text-align:right;" id="rmQtyCell_${id}">
                <span class="badge ${rem<0?'b-danger':zero?'b-warn':'b-ok'}" style="font-size:13px;font-weight:700;">${N(r.qtyKg)} ${isKg?'KG':'pcs'}</span>
              </td>
              <td style="text-align:right;color:${consKg>0?'var(--danger)':'var(--muted)'};">
                ${consKg > 0 ? `<span style="font-weight:700;">−${isKg ? (consKg<1 ? Math.round(consKg*1000)+' gm' : N(Math.round(consKg*100)/100)+' KG') : N(consKg)+' pcs'}</span>` : '<span style="font-size:12px;">—</span>'}
              </td>
              <td style="text-align:right;">
                <span class="badge ${rem<0?'b-danger':rem===0?'b-warn':'b-ok'}" style="font-size:13px;font-weight:800;">
                  ${isKg ? (rem<0?'−':'')+N(Math.abs(Math.round(rem*100)/100))+' KG' : N(Math.max(0,rem))+' pcs'}
                </span>
              </td>
              <td style="text-align:right;" id="rmMinCell_${id}">
                ${mq > 0
                  ? `<span class="badge ${urgent?'b-danger':'b-gray'}" style="font-size:12px;">${urgent?'🔔 ':''}${N(mq)} ${isKg?'KG':'pcs'}</span>`
                  : `<span style="color:var(--muted);font-size:12px;">—</span>`}
              </td>
              <td style="text-align:right;">${statusBadge}</td>
              <td>
                <div style="display:flex;gap:5px;flex-wrap:wrap;">
                  <button class="btn btn-outline btn-xs" onclick="editRMQty(${id})">✏️ Qty</button>
                  <button class="btn btn-outline btn-xs" onclick="editRMMin(${id})">✏️ Min</button>
                </div>
              </td>
            </tr>`;
          }).join('')}
          <tr style="background:#F7F9FC;font-weight:800;">
            <td colspan="2" style="text-align:right;color:var(--text2);">Total</td>
            <td style="text-align:right;"><span class="badge b-gray" style="font-size:13px;">${N(totalKg)} KG</span></td>
            <td style="text-align:right;font-size:13px;color:var(--text2);">${N(totalGm)} gm</td>
            <td colspan="3"></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>`;
}

function addProduct() {
  const code  = (document.getElementById('newCode').value  || '').trim();
  const name  = (document.getElementById('newName').value  || '').trim();
  const size  = (document.getElementById('newSize').value  || '').trim();
  const mat   = (document.getElementById('newMat').value   || '').trim();
  const stockVal = document.getElementById('newStock').value;

  if (!code) { toast('Product Code is required','error'); document.getElementById('newCode').focus(); return; }
  if (!name) { toast('Product Name is required','error'); document.getElementById('newName').focus(); return; }
  if (stockVal === '' || stockVal === null) { toast('Current Stock is required','error'); document.getElementById('newStock').focus(); return; }
  if (S.products.find(p => String(p.code) === String(code))) { toast('Product code ' + code + ' already exists!','error'); return; }
  if (S.products.length >= 1000) { toast('Maximum 1000 products reached','error'); return; }

  const stock    = parseInt(stockVal) || 0;
  const minStock = parseInt(document.getElementById('newMinStock').value) || 0;
  const product = { _docId: code, id: S.nextProdId++, code, name, size, material: mat, stock, minStock, pmCode: '' };
  S.products.push(product);

  // clear fields without losing focus context
  document.getElementById('newCode').value     = '';
  document.getElementById('newName').value     = '';
  document.getElementById('newSize').value     = '';
  document.getElementById('newMat').value      = '';
  document.getElementById('newStock').value    = '';
  document.getElementById('newMinStock').value = '';

  persistProduct(product).then(() => {
    toast('Product ' + code + ' — ' + name + ' added!', 'success');
    renderMain(); renderNav();
  }).catch(error => {
    S.products = S.products.filter(item => item !== product);
    toast(`Could not add product: ${error.message}`, 'error');
    renderMain(); renderNav();
  });
  // scroll new product row into view
  setTimeout(() => {
    const rows = document.querySelectorAll('#mainArea tbody tr');
    if (rows.length) rows[rows.length - 1].scrollIntoView({behavior:'smooth', block:'nearest'});
  }, 80);
}

// ════════════════════════════════════════════════════
// PRODUCT SEARCH
// ════════════════════════════════════════════════════
function filterProducts(q) {
  S._productSearch = (q || '').trim();
  const lower = S._productSearch.toLowerCase();
  const rows  = document.querySelectorAll('#prodTableBody tr');
  let vis = 0;
  rows.forEach(tr => {
    const nameTd = tr.querySelector('td[data-name]');
    const codeTd = tr.querySelector('td[data-code]');
    const pmTd   = tr.querySelector('td[id^="pmCodeCell_"]');
    const name   = nameTd ? nameTd.dataset.name : '';           // already lowercased
    const code   = codeTd ? codeTd.dataset.code.toLowerCase() : '';
    const pmText = pmTd ? (pmTd.textContent || '').toLowerCase() : '';
    const match  = !lower || name.includes(lower) || code.includes(lower) || pmText.includes(lower);
    tr.style.display = match ? '' : 'none';
    if (match) vis++;
  });
  const countEl = document.getElementById('prodSearchCount');
  if (countEl) {
    countEl.textContent = lower
      ? vis + ' of ' + S.products.length + ' products'
      : S.products.length + ' products';
    countEl.style.color = (lower && vis === 0) ? 'var(--danger)' : 'var(--muted)';
  }
  const clrBtn = document.getElementById('prodSearchClear');
  if (clrBtn) clrBtn.style.display = lower ? 'block' : 'none';
}

function clearProdSearch() {
  S._productSearch = '';
  const inp = document.getElementById('prodSearch');
  if (inp) { inp.value = ''; inp.focus(); }
  filterProducts('');
}

// Packaging search helpers to avoid re-rendering the whole nav (which steals focus)
function pkgSearchInputChanged(el) {
  S._pkgSearch = (el.value || '').trim();
  const main = document.getElementById('mainArea');
  if (main) main.innerHTML = renderPackaging();
  // restore focus to the input and move caret to end
  setTimeout(() => {
    const inp = document.getElementById('pkgSearch');
    if (inp) { inp.focus(); inp.selectionStart = inp.selectionEnd = inp.value.length; }
  }, 10);
}
function clearPkgSearch() {
  S._pkgSearch = '';
  const main = document.getElementById('mainArea');
  if (main) main.innerHTML = renderPackaging();
  setTimeout(()=>{const inp = document.getElementById('pkgSearch'); if(inp){inp.focus();}},10);
}

function editStock(prodId) {
  const p = S.products.find(x=>x.id===prodId);
  const cell = document.getElementById('stockCell_'+prodId);
  cell.innerHTML = `<div class="edit-row">
    <input type="number" class="inp inp-sm" id="se_${prodId}" value="${p.stock}" min="0">
    <button class="btn btn-accent btn-xs" onclick="saveStock(${prodId})">Save</button>
    <button class="btn btn-outline btn-xs" onclick="renderMain()">×</button>
  </div>`;
  document.getElementById('se_'+prodId).select();
}

async function saveStock(prodId) {
  const val = parseInt(document.getElementById('se_'+prodId).value);
  if (isNaN(val)||val<0){toast('Invalid quantity','error');return;}
  const product = S.products.find(x=>x.id===prodId);
  product.stock = val;
  await commitChange(() => persistProduct(product), 'Stock updated');
}

function editMinStock(prodId) {
  const p = S.products.find(x=>x.id===prodId);
  const cell = document.getElementById('minStockCell_'+prodId);
  cell.innerHTML = `<div class="edit-row">
    <input type="number" class="inp inp-sm" id="ms_${prodId}" value="${p.minStock||0}" min="0" placeholder="0">
    <button class="btn btn-accent btn-xs" onclick="saveMinStock(${prodId})">Save</button>
    <button class="btn btn-outline btn-xs" onclick="renderMain()">×</button>
  </div>`;
  document.getElementById('ms_'+prodId).select();
}

async function saveMinStock(prodId) {
  const val = parseInt(document.getElementById('ms_'+prodId).value);
  if (isNaN(val)||val<0){toast('Enter a valid minimum stock value','error');return;}
  const product = S.products.find(x=>x.id===prodId);
  product.minStock = val;
  await commitChange(() => persistProduct(product), 'Min stock updated');
}

// ── Packaging inline edit ─────────────────────────
function editPkgStock(pkgId) {
  const p = S.packaging[pkgId];
  const cell = document.getElementById('pkgStockCell_'+pkgId);
  cell.innerHTML = `<div class="edit-row">
    <input type="number" class="inp inp-sm" id="pse_${pkgId}" value="${p.stock}" min="0">
    <button class="btn btn-accent btn-xs" onclick="savePkgStock(${pkgId})">Save</button>
    <button class="btn btn-outline btn-xs" onclick="renderMain()">×</button>
  </div>`;
  document.getElementById('pse_'+pkgId).select();
}
async function savePkgStock(pkgId) {
  const val = parseInt(document.getElementById('pse_'+pkgId).value);
  if (isNaN(val)||val<0){toast('Invalid quantity','error');return;}
  const item = S.packaging[pkgId];
  item.stock = val;
  await commitChange(() => persistPackaging(item), 'Packaging stock updated');
}
function editPkgMin(pkgId) {
  const p = S.packaging[pkgId];
  const cell = document.getElementById('pkgMinCell_'+pkgId);
  cell.innerHTML = `<div class="edit-row">
    <input type="number" class="inp inp-sm" id="pmq_${pkgId}" value="${p.minQty||0}" min="0" placeholder="0">
    <button class="btn btn-accent btn-xs" onclick="savePkgMin(${pkgId})">Save</button>
    <button class="btn btn-outline btn-xs" onclick="renderMain()">×</button>
  </div>`;
  document.getElementById('pmq_'+pkgId).select();
}
async function savePkgMin(pkgId) {
  const val = parseInt(document.getElementById('pmq_'+pkgId).value);
  if (isNaN(val)||val<0){toast('Enter a valid minimum quantity','error');return;}
  const item = S.packaging[pkgId];
  item.minQty = val;
  await commitChange(() => persistPackaging(item), 'Min quantity updated');
}

// ── Raw Materials inline edit ─────────────────────
function editRMQty(rmId) {
  const r = S.rmItems[rmId];
  const cell = document.getElementById('rmQtyCell_'+rmId);
  cell.innerHTML = `<div class="edit-row">
    <input type="number" class="inp inp-sm" id="rse_${rmId}" value="${r.qtyKg}" min="0" step="0.001">
    <span style="font-size:12px;color:var(--muted);">KG</span>
    <button class="btn btn-accent btn-xs" onclick="saveRMQty(${rmId})">Save</button>
    <button class="btn btn-outline btn-xs" onclick="renderMain()">×</button>
  </div>`;
  document.getElementById('rse_'+rmId).select();
}
async function saveRMQty(rmId) {
  const val = parseFloat(document.getElementById('rse_'+rmId).value);
  if (isNaN(val)||val<0){toast('Invalid quantity','error');return;}
  const item = S.rmItems[rmId];
  item.qtyKg = val;
  await commitChange(() => persistRawMaterial(item), 'RM quantity updated');
}
function editRMMin(rmId) {
  const r = S.rmItems[rmId];
  const cell = document.getElementById('rmMinCell_'+rmId);
  cell.innerHTML = `<div class="edit-row">
    <input type="number" class="inp inp-sm" id="rmq_${rmId}" value="${r.minQty||0}" min="0" step="0.001" placeholder="0">
    <span style="font-size:12px;color:var(--muted);">KG</span>
    <button class="btn btn-accent btn-xs" onclick="saveRMMin(${rmId})">Save</button>
    <button class="btn btn-outline btn-xs" onclick="renderMain()">×</button>
  </div>`;
  document.getElementById('rmq_'+rmId).select();
}
async function saveRMMin(rmId) {
  const val = parseFloat(document.getElementById('rmq_'+rmId).value);
  if (isNaN(val)||val<0){toast('Enter a valid minimum quantity','error');return;}
  const item = S.rmItems[rmId];
  item.minQty = val;
  await commitChange(() => persistRawMaterial(item), 'Min quantity updated');
}

// ── PM Code (Products tab) inline edit ───────────────
function editPMCode(prodId) {
  const p = S.products.find(x => x.id === prodId);
  const cell = document.getElementById('pmCodeCell_'+prodId);
  cell.innerHTML = `<div class="edit-row">
    <input type="text" class="inp inp-sm" id="pmc_${prodId}" value="${p.pmCode||''}" placeholder="PM-XXXXX" style="width:130px;font-family:monospace;">
    <button class="btn btn-accent btn-xs" onclick="savePMCode(${prodId})">Save</button>
    <button class="btn btn-outline btn-xs" onclick="renderMain()">×</button>
  </div>
  <div style="font-size:10px;color:var(--muted);margin-top:2px;">#${p.code}</div>`;
  const inp = document.getElementById('pmc_'+prodId);
  inp.select();
  inp.addEventListener('keydown', e => { if(e.key==='Enter') savePMCode(prodId); if(e.key==='Escape') renderMain(); });
}
async function savePMCode(prodId) {
  const val = (document.getElementById('pmc_'+prodId).value||'').trim().toUpperCase();
  const p = S.products.find(x => x.id === prodId);
  p.pmCode = val;
  await commitChange(() => persistProduct(p), 'PM code updated');
}

// ── PM Code (Packaging tab) inline edit ──────────────
function editPkgCode(pkgId) {
  const p = S.packaging[pkgId];
  const cell = document.getElementById('pkgCodeCell_'+pkgId);
  cell.innerHTML = `<div class="edit-row">
    <input type="text" class="inp inp-sm" id="pkc_${pkgId}" value="${p.code||''}" placeholder="PM-XXXXX" style="width:130px;font-family:monospace;">
    <button class="btn btn-accent btn-xs" onclick="savePkgCode(${pkgId})">Save</button>
    <button class="btn btn-outline btn-xs" onclick="renderMain()">×</button>
  </div>`;
  const inp = document.getElementById('pkc_'+pkgId);
  inp.select();
  inp.addEventListener('keydown', e => { if(e.key==='Enter') savePkgCode(pkgId); if(e.key==='Escape') renderMain(); });
}
async function savePkgCode(pkgId) {
  const val = (document.getElementById('pkc_'+pkgId).value||'').trim().toUpperCase();
  const item = S.packaging[pkgId];
  const previousCode = item.code;
  item.code = val;
  await commitChange(() => persistPackaging(item, previousCode), 'Packaging code updated');
}

// ── RM Code (Raw Materials tab) inline edit ───────────
function editRMCode(rmId) {
  const r = S.rmItems[rmId];
  const cell = document.getElementById('rmCodeCell_'+rmId);
  cell.innerHTML = `<div class="edit-row">
    <input type="text" class="inp inp-sm" id="rmc_${rmId}" value="${r.code||''}" placeholder="RM-XXXXX" style="width:130px;font-family:monospace;">
    <button class="btn btn-accent btn-xs" onclick="saveRMCode(${rmId})">Save</button>
    <button class="btn btn-outline btn-xs" onclick="renderMain()">×</button>
  </div>`;
  const inp = document.getElementById('rmc_'+rmId);
  inp.select();
  inp.addEventListener('keydown', e => { if(e.key==='Enter') saveRMCode(rmId); if(e.key==='Escape') renderMain(); });
}
async function saveRMCode(rmId) {
  const val = (document.getElementById('rmc_'+rmId).value||'').trim().toUpperCase();
  const item = S.rmItems[rmId];
  const previousCode = item.code;
  item.code = val;
  await commitChange(() => persistRawMaterial(item, previousCode), 'RM code updated');
}

// ── Kit tab: link packaging item to PM code ───────────
function editKitPkgCode(kitId, idx) {
  const p   = KIT_MATERIALS[kitId].pkg[idx];
  const cell = document.getElementById('kitPkgCode_'+kitId+'_'+idx);
  // Build dropdown from S.packaging, grouped by code
  const opts = S.packaging.map(x =>
    `<option value="${x.code}" ${x.code===p.pmCode?'selected':''}>${x.code} — ${x.name.substring(0,50)}</option>`
  ).join('');
  cell.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:4px;min-width:220px;">
      <select class="inp inp-sm" id="kpc_${kitId}_${idx}" style="font-family:monospace;font-size:12px;max-width:280px;">
        <option value="">— unlink —</option>
        ${opts}
      </select>
      <div style="font-size:11px;color:var(--muted);margin:-2px 0 2px;">Or type a code:</div>
      <input type="text" class="inp inp-sm" id="kpcm_${kitId}_${idx}" placeholder="PM-XXXXX" value="${p.pmCode||''}" style="font-family:monospace;max-width:140px;">
      <div style="display:flex;gap:4px;">
        <button class="btn btn-accent btn-xs" onclick="saveKitPkgCode('${kitId}',${idx})">🔗 Link</button>
        <button class="btn btn-outline btn-xs" onclick="renderMain()">×</button>
      </div>
    </div>`;
  const sel = document.getElementById('kpc_'+kitId+'_'+idx);
  const man = document.getElementById('kpcm_'+kitId+'_'+idx);
  // Sync select → manual input
  sel.addEventListener('change', () => { if(sel.value) man.value = sel.value; });
}
async function saveKitPkgCode(kitId, idx) {
  // Prefer manual text input if filled; else use select
  const man = (document.getElementById('kpcm_'+kitId+'_'+idx).value||'').trim().toUpperCase();
  const sel = (document.getElementById('kpc_'+kitId+'_'+idx).value||'').toUpperCase();
  const val = man || sel;
  KIT_MATERIALS[kitId].pkg[idx].pmCode = val;
  const linked = S.packaging.find(x => x.code === val);
  await commitChange(() => persistKitMaterial(kitId, 'pkg', idx, KIT_MATERIALS[kitId].pkg[idx]), linked ? `Linked to "${linked.name}"` : (val ? 'Code saved (no match in Packaging tab yet)' : 'Unlinked'));
}

// ── Kit tab: link RM item to RM code ─────────────────
function editKitRMCode(kitId, idx) {
  const r   = KIT_MATERIALS[kitId].rm[idx];
  const cell = document.getElementById('kitRMCode_'+kitId+'_'+idx);
  const opts = S.rmItems.map(x =>
    `<option value="${x.code}" ${x.code===r.rmCode?'selected':''}>${x.code} — ${x.name.substring(0,50)}</option>`
  ).join('');
  cell.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:4px;min-width:220px;">
      <select class="inp inp-sm" id="krc_${kitId}_${idx}" style="font-family:monospace;font-size:12px;max-width:280px;">
        <option value="">— unlink —</option>
        ${opts}
      </select>
      <div style="font-size:11px;color:var(--muted);margin:-2px 0 2px;">Or type a code:</div>
      <input type="text" class="inp inp-sm" id="krcm_${kitId}_${idx}" placeholder="RM-XXXXX" value="${r.rmCode||''}" style="font-family:monospace;max-width:140px;">
      <div style="display:flex;gap:4px;">
        <button class="btn btn-accent btn-xs" onclick="saveKitRMCode('${kitId}',${idx})">🔗 Link</button>
        <button class="btn btn-outline btn-xs" onclick="renderMain()">×</button>
      </div>
    </div>`;
  const sel = document.getElementById('krc_'+kitId+'_'+idx);
  const man = document.getElementById('krcm_'+kitId+'_'+idx);
  sel.addEventListener('change', () => { if(sel.value) man.value = sel.value; });
}
async function saveKitRMCode(kitId, idx) {
  const man = (document.getElementById('krcm_'+kitId+'_'+idx).value||'').trim().toUpperCase();
  const sel = (document.getElementById('krc_'+kitId+'_'+idx).value||'').toUpperCase();
  const val = man || sel;
  KIT_MATERIALS[kitId].rm[idx].rmCode = val;
  const linked = S.rmItems.find(x => x.code === val);
  await commitChange(() => persistKitMaterial(kitId, 'rm', idx, KIT_MATERIALS[kitId].rm[idx]), linked ? `Linked to "${linked.name}"` : (val ? 'Code saved (no match in Raw Materials tab yet)' : 'Unlinked'));
}

function editName(prodId) {
  const p = S.products.find(x=>x.id===prodId);
  const cell = document.getElementById('nameCell_'+prodId);
  cell.innerHTML = `<div class="inline-edit-wrap">
    <input type="text" class="inp inp-sm" id="nm_${prodId}" value="${p.name.replace(/"/g,'&quot;')}" style="width:180px;" onkeydown="if(event.key==='Enter')saveName(${prodId});if(event.key==='Escape')renderMain();">
    <button class="btn btn-accent btn-xs" onclick="saveName(${prodId})">✓</button>
    <button class="btn btn-outline btn-xs" onclick="renderMain()">×</button>
  </div>`;
  const inp = document.getElementById('nm_'+prodId);
  inp.focus(); inp.select();
}
async function saveName(prodId) {
  const val = (document.getElementById('nm_'+prodId).value || '').trim();
  if (!val) { toast('Product name cannot be empty','error'); return; }
  const product = S.products.find(x=>x.id===prodId);
  product.name = val;
  await commitChange(() => persistProduct(product), 'Name updated');
}

function editSize(prodId) {
  const p = S.products.find(x=>x.id===prodId);
  const cell = document.getElementById('sizeCell_'+prodId);
  cell.innerHTML = `<div class="inline-edit-wrap">
    <input type="text" class="inp inp-sm" id="sz_${prodId}" value="${(p.size||'').replace(/"/g,'&quot;')}" style="width:120px;" onkeydown="if(event.key==='Enter')saveSize(${prodId});if(event.key==='Escape')renderMain();">
    <button class="btn btn-accent btn-xs" onclick="saveSize(${prodId})">✓</button>
    <button class="btn btn-outline btn-xs" onclick="renderMain()">×</button>
  </div>`;
  const inp = document.getElementById('sz_'+prodId);
  inp.focus(); inp.select();
}
async function saveSize(prodId) {
  const val = (document.getElementById('sz_'+prodId).value || '').trim();
  const product = S.products.find(x=>x.id===prodId);
  product.size = val;
  await commitChange(() => persistProduct(product), 'Size updated');
}

function editMat(prodId) {
  const p = S.products.find(x=>x.id===prodId);
  const cell = document.getElementById('matCell_'+prodId);
  cell.innerHTML = `<div class="inline-edit-wrap">
    <input type="text" class="inp inp-sm" id="mt_${prodId}" value="${(p.material||'').replace(/"/g,'&quot;')}" style="width:140px;" onkeydown="if(event.key==='Enter')saveMat(${prodId});if(event.key==='Escape')renderMain();">
    <button class="btn btn-accent btn-xs" onclick="saveMat(${prodId})">✓</button>
    <button class="btn btn-outline btn-xs" onclick="renderMain()">×</button>
  </div>`;
  const inp = document.getElementById('mt_'+prodId);
  inp.focus(); inp.select();
}
async function saveMat(prodId) {
  const val = (document.getElementById('mt_'+prodId).value || '').trim();
  const product = S.products.find(x=>x.id===prodId);
  product.material = val;
  await commitChange(() => persistProduct(product), 'Material updated');
}

async function deleteProd(prodId) {
  const p = S.products.find(x=>x.id===prodId);
  if (!confirm(`Delete "${p.name}"?\n\nThis will also remove it from all kit compositions.`)) return;
  const affectedKits = S.kits.filter(kit => kit.items.some(item => item.productCode === p.code));
  S.products = S.products.filter(x=>x.id!==prodId);
  S.kits.forEach(k => k.items = k.items.filter(it=>it.productCode!==p.code));
  try {
    await deleteDoc(doc(db, 'products', p._docId || p.code));
    await Promise.all(affectedKits.map(persistKitItems));
    toast('Product deleted','warning');
    renderMain(); renderNav();
  } catch (error) {
    toast(`Could not delete product: ${error.message}`, 'error');
    await loadFirestoreData();
  }
}

// ════════════════════════════════════════════════════
// KIT TAB
// ════════════════════════════════════════════════════
function renderKit(kit) {
  const uniqueItems = Array.from(new Map(kit.items.map(it => [it.productCode, it])).values());
  const orderScale = kit.orderQty / 6;
  const isRawItem = it => normKey(it.section).includes('raw') || normKey(it.step).includes('raw');
  const rawItems = uniqueItems.filter(isRawItem);
  const mainItems = uniqueItems.filter(it => !isRawItem(it));
  const sections = {};
  mainItems.forEach(it => {
    if (!sections[it.section]) sections[it.section] = [];
    sections[it.section].push(it);
  });

  const uniqueProds = mainItems.length;
  const insuffCount = mainItems.filter(it=>{
    const p=getProd(it.productCode);
    return p && remaining(it.productCode) < 0;
  }).length;

  let tableRows = '';
  Object.entries(sections).forEach(([secName, items]) => {
    tableRows += `<tr class="section-row"><td colspan="8">${secName}</td></tr>`;
    items.forEach((it,i) => {
      const p     = getProd(it.productCode);
      const total = Math.ceil(it.pcs * orderScale - 1e-9);
      const rem   = p ? remaining(it.productCode) : 0;
      const canFulfil = p && p.stock >= total;
      tableRows += `<tr>
        <td><span style="font-size:11px;color:var(--muted);">${it.step||'—'}</span></td>
        <td>
          <span class="code-pill" style="background:${kit.colour};">${p && p.pmCode ? p.pmCode : it.productCode}</span>
        </td>
        <td style="font-weight:600;max-width:240px;">${p?p.name:'<em style="color:var(--muted)">Product not found (code '+it.productCode+')</em>'}</td>
        <td style="text-align:center;">
          <div id="pcsCell_${kit.id}_${it.productCode}_${i}">
            <span style="font-weight:700;">${it.pcs}</span>
            <button class="btn btn-outline btn-xs" style="margin-left:4px;" onclick="editPcs('${kit.id}','${it.productCode}',${i})">✏️</button>
          </div>
        </td>
        <td style="font-weight:700;font-size:14px;">${N(total)}</td>
        <td>${p?`<div style="font-weight:600;color:${rem<0?'var(--danger)':rem===0?'var(--warn)':'var(--ok)'};">${rem<0?'⚠️ ':''} ${N(rem)}</div>`:'—'}</td>
        <td>
          <span class="badge ${canFulfil?'b-ok':'b-danger'}">${canFulfil?'✅ OK':'🔴 Short'}</span>
          <button class="btn btn-danger btn-xs" style="margin-left:6px;" onclick="removeKitItem('${kit.id}','${it.productCode}',${i})">🗑️</button>
        </td>
      </tr>`;
    });
  });

  return `
  <div class="sh">
    <div style="flex:1;min-width:0;">
      <div id="kitNameDisplay_${kit.id}" class="sh-title" style="display:flex;align-items:center;gap:10px;">
        <span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${kit.colour};flex-shrink:0;"></span>
        <span class="editable-cell" onclick="editKitName('${kit.id}')" title="Click to rename kit" style="font-size:inherit;font-weight:inherit;">
          <span>${kit.name}</span><span class="edit-hint" style="font-size:13px;">✏️</span>
        </span>
      </div>
      <div class="sh-sub">Configure kit composition and order quantity · each product row shows total units needed</div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
      <button class="btn btn-accent btn-sm" onclick="openAddKitItemModal('${kit.id}')">➕ Add Product</button>
      <button class="btn btn-danger btn-sm" onclick="deleteKit('${kit.id}')">🗑️ Remove Kit</button>
    </div>
  </div>

  <div class="kit-summary">
    <div class="kstat">
      <div class="kstat-label">Order Quantity</div>
      <div style="margin-top:6px;" class="order-qty-wrap">
        <input type="number" class="inp" id="oq_${kit.id}" value="${kit.orderQty}" min="1" style="width:110px;font-weight:800;font-size:18px;">
        <button class="btn btn-outline btn-sm" onclick="updateOrderQty('${kit.id}')">Update</button>
      </div>
      <div class="kstat-sub" style="margin-top:6px;">Number of kits to produce</div>
    </div>
    <div class="kstat"><div class="kstat-label">Unique Products</div><div class="kstat-value">${uniqueProds}</div><div class="kstat-sub">${kit.items.length} line items (incl. duplicates)</div></div>
    <div class="kstat"><div class="kstat-label">Stock Shortfalls</div>
      <div class="kstat-value" style="color:${insuffCount>0?'var(--danger)':'var(--ok)'};">${insuffCount}</div>
      <div class="kstat-sub">${insuffCount>0?'products need reordering':'All products have sufficient stock'}</div>
    </div>
  </div>

  <div class="card" style="margin-bottom:18px;">
    <div class="card-hdr">Kit Composition <span class="card-hdr-right">✏️ Edit pcs/kit inline · 🗑️ Remove items</span></div>
    <div class="tbl-wrap">
      <table>
        <thead><tr>
          <th>Step</th><th>Code</th><th>Product Name</th>
          <th style="text-align:center;">Pcs / Kit</th>
          <th>Total Needed</th><th>Stock Remaining*</th><th>Status</th>
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
    <div style="padding:10px 16px;font-size:11.5px;color:var(--muted);">* Remaining = Current Stock − total consumed across ALL kit tabs</div>
  </div>

    ${rawItems.length ? `
    <div class="card" style="border-left:4px solid #B7770D;margin-bottom:18px;">
      <div class="card-hdr" style="background:#FEF9ED;color:#B7770D;">🧪 Raw Materials in This Kit (${N(kit.orderQty)} kits)</div>
      <div class="tbl-wrap">
        <table>
          <thead><tr style="background:#FEFCF3;">
            <th>Step</th><th>Code</th><th>Material Name</th>
            <th style="text-align:center;">Pcs / Kit</th>
            <th>Total Needed</th><th>Stock Remaining*</th><th>Status</th>
          </tr></thead>
          <tbody>
            ${rawItems.map((it,i) => {
              const p = getProd(it.productCode);
              const total = Math.ceil(it.pcs * orderScale - 1e-9);
              const rem = p ? remaining(it.productCode) : 0;
              const canFulfil = p && p.stock >= total;
              return `<tr>
                <td><span style="font-size:11px;color:var(--muted);">${it.step||'—'}</span></td>
                <td>
                  <span class="code-pill" style="background:${kit.colour};">${p && p.pmCode ? p.pmCode : it.productCode}</span>
                </td>
                <td style="font-weight:600;max-width:240px;">${p ? p.name : '<em style="color:var(--muted)">Product not found (code '+it.productCode+')</em>'}</td>
                <td style="text-align:center;">${it.pcs}</td>
                <td style="font-weight:700;font-size:14px;">${N(total)}</td>
                <td>${p ? `<div style="font-weight:600;color:${rem<0?'var(--danger)':rem===0?'var(--warn)':'var(--ok)'};">${rem<0?'⚠️ ':''} ${N(rem)}</div>` : '—'}</td>
                <td>
                  <span class="badge ${canFulfil?'b-ok':'b-danger'}">${canFulfil?'✅ OK':'🔴 Short'}</span>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <div style="padding:10px 16px;font-size:11.5px;color:var(--muted);">* Remaining = Current Stock − total consumed across ALL kit tabs</div>
    </div>` : ''}

  ${(()=>{
    const mats = KIT_MATERIALS[kit.id];
    if (!mats || (!mats.pkg.length && !mats.rm.length)) return '';

    const pkgRows = mats.pkg.map((p, pIdx) => {
      const pkgItem = S.packaging.find(x => x.code === p.pmCode);
        const totalNeeded = Math.ceil(p.qtyPer6 * orderScale - 1e-9);
      const stock = pkgItem ? pkgItem.stock : null;
      const rem   = pkgItem ? remainingPkg(pkgItem) : null;
      const ok    = rem !== null && rem >= totalNeeded;
      const rowCls = rem !== null && rem < 0 ? 'row-danger' : rem !== null && rem < totalNeeded ? 'row-warn' : '';
      return `<tr class="${rowCls}">
        <td id="kitPkgCode_${kit.id}_${pIdx}" style="white-space:nowrap;">
          ${p.pmCode
            ? `<div class="editable-cell" onclick="editKitPkgCode('${kit.id}',${pIdx})" title="Click to change link">
                 <span class="code-pill" style="font-size:11px;">${p.pmCode}</span><span class="edit-hint">✏️</span>
               </div>`
            : `<button class="btn btn-accent btn-xs" onclick="editKitPkgCode('${kit.id}',${pIdx})" style="font-size:11px;white-space:nowrap;">🔗 Link PM</button>`}
        </td>
        <td style="font-weight:600;max-width:300px;">${p.name}</td>
        <td style="text-align:right;">${p.qtyPer6} per 6 kits</td>
        <td style="text-align:right;font-weight:700;">${N(totalNeeded)}</td>
        <td style="text-align:right;">${stock !== null ? N(stock) : '<span style="color:var(--muted)">—</span>'}</td>
        <td style="text-align:right;">${rem !== null ? `<span style="font-weight:800;color:${rem<0?'var(--danger)':rem<totalNeeded?'var(--warn)':'var(--ok)'};">${rem<0?'−'+N(Math.abs(rem)):N(rem)}</span>` : '<span style="color:var(--muted)">—</span>'}</td>
        <td><span class="badge ${ok?'b-ok':rem===null?'b-gray':'b-danger'}">${ok?'✅ OK':rem===null?'⚠️ Unlinked':'🔴 Short'}</span></td>
      </tr>`;
    }).join('');

    const rmRows = mats.rm.map((r, rIdx) => {
        const rmItem = resolveMasterItem(S.rmItems, r.rmCode, r.name);
      const totalNeeded = r.unit === 'gms'
        ? Math.ceil(r.qtyPer6 * r.gmsEach * orderScale * 1000 - 1e-9) / 1000
        : Math.ceil(r.qtyPer6 * orderScale - 1e-9);
      const isKg = r.unit === 'gms';
      const stock = rmItem ? rmItem.qtyKg : null;
      const rem   = rmItem ? remainingRM(rmItem) : null;
      const ok    = rem !== null && rem >= totalNeeded;
      const rowCls = rem !== null && rem < 0 ? 'row-danger' : rem !== null && rem < totalNeeded ? 'row-warn' : '';
      const unit = isKg ? 'KG' : 'pcs';
      return `<tr class="${rowCls}">
        <td id="kitRMCode_${kit.id}_${rIdx}" style="white-space:nowrap;">
          ${r.rmCode
            ? `<div class="editable-cell" onclick="editKitRMCode('${kit.id}',${rIdx})" title="Click to change link">
                 <span class="code-pill" style="font-size:11px;">${r.rmCode}</span><span class="edit-hint">✏️</span>
               </div>`
            : `<button class="btn btn-accent btn-xs" onclick="editKitRMCode('${kit.id}',${rIdx})" style="font-size:11px;white-space:nowrap;">🔗 Link RM</button>`}
        </td>
        <td style="font-weight:600;">${r.name}</td>
        <td style="text-align:right;">${isKg ? r.gmsEach+'gm per kit' : r.qtyPer6+' per 6 kits'}</td>
        <td style="text-align:right;font-weight:700;">${isKg ? N(Math.ceil(totalNeeded*100 - 1e-9)/100)+' KG' : N(totalNeeded)+' pcs'}</td>
        <td style="text-align:right;">${stock !== null ? N(stock)+' '+unit : '<span style="color:var(--muted)">—</span>'}</td>
        <td style="text-align:right;">${rem !== null ? `<span style="font-weight:800;color:${rem<0?'var(--danger)':rem<totalNeeded?'var(--warn)':'var(--ok)'};">${(rem<0?'−':'')+N(Math.abs(Math.round(rem*100)/100))} ${unit}</span>` : '<span style="color:var(--muted)">—</span>'}</td>
        <td><span class="badge ${ok?'b-ok':rem===null?'b-gray':'b-danger'}">${ok?'✅ OK':rem===null?'⚠️ Unlinked':'🔴 Short'}</span></td>
      </tr>`;
    }).join('');

    return `
    ${mats.pkg.length ? `
    <div class="card" style="border-left:4px solid #8E44AD;margin-bottom:14px;">
      <div class="card-hdr" style="background:#F5EEF8;color:#6C3483;">📦 Packaging for This Order (${N(kit.orderQty)} kits)</div>
      <div class="tbl-wrap"><table>
        <thead><tr style="background:#FAF3FF;">
          <th>PM Code</th><th>Item Name</th><th style="text-align:right;">Rate</th>
          <th style="text-align:right;">This Order Needs</th><th style="text-align:right;">Stock on Hand</th>
          <th style="text-align:right;">Remaining After All Kits</th><th>Status</th>
        </tr></thead>
        <tbody>${pkgRows}</tbody>
      </table></div>
    </div>` : ''}
    ${mats.rm.length ? `
    <div class="card" style="border-left:4px solid #B7770D;">
      <div class="card-hdr" style="background:#FEF9ED;color:#B7770D;">🧪 Raw Materials for This Order (${N(kit.orderQty)} kits)</div>
      <div class="tbl-wrap"><table>
        <thead><tr style="background:#FEFCF3;">
          <th>RM Code</th><th>Material Name</th><th style="text-align:right;">Rate</th>
          <th style="text-align:right;">This Order Needs</th><th style="text-align:right;">Stock on Hand</th>
          <th style="text-align:right;">Remaining After All Kits</th><th>Status</th>
        </tr></thead>
        <tbody>${rmRows}</tbody>
      </table></div>
    </div>` : ''}`;
  })()}`;
}

async function updateOrderQty(kitId) {
  const val = parseInt(document.getElementById('oq_'+kitId).value);
  if (!val||val<1){toast('Enter a valid quantity','error');return;}
  getKit(kitId).orderQty = val;
  await commitChange(() => persistKit(getKit(kitId)), 'Order quantity updated');
}

function editPcs(kitId, productCode, index) {
  const kit = getKit(kitId);
  const it = kit.items.find(x=>x.productCode==productCode);
  const cellId = `pcsCell_${kitId}_${productCode}_${index}`;
  document.getElementById(cellId).innerHTML = `<div class="edit-row">
    <input type="number" class="inp inp-xs" id="pe_${kitId}_${productCode}_${index}" value="${it.pcs}" min="1">
    <button class="btn btn-accent btn-xs" onclick="savePcs('${kitId}','${productCode}',${index})">✓</button>
    <button class="btn btn-outline btn-xs" onclick="renderMain()">×</button>
  </div>`;
  document.getElementById(`pe_${kitId}_${productCode}_${index}`).select();
}

async function savePcs(kitId, productCode, index) {
  const val = parseInt(document.getElementById(`pe_${kitId}_${productCode}_${index}`).value);
  if (!val||val<1){toast('Invalid value','error');return;}
  const kit = getKit(kitId);
  const target = kit.items.find(x => x.productCode == productCode);
  if (target) target.pcs = val;
  await commitChange(() => persistKitItems(kit), 'Updated');
}

async function removeKitItem(kitId, productCode, index) {
  const kit = getKit(kitId);
  const occ = kit.items.findIndex(it => it.productCode == productCode);
  if (occ >= 0) {
    kit.items.splice(occ, 1);
    await commitChange(() => persistKitItems(kit), 'Removed from kit');
  } else {
    toast('Item not found in kit','error');
  }
}

async function deleteKit(kitId) {
  const kit = getKit(kitId);
  if (!confirm(`Remove the entire "${kit.name}" tab?\nThis cannot be undone.`)) return;
  try {
    const itemSnapshot = await getDocs(collection(db, 'kits', kitId, 'items'));
    const batch = writeBatch(db);
    itemSnapshot.docs.forEach(snapshot => batch.delete(snapshot.ref));
    batch.delete(doc(db, 'kits', kitId));
    await batch.commit();
    S.kits = S.kits.filter(k=>k.id!==kitId);
    S.activeTab = 'products';
    toast(`"${kit.name}" removed`,'warning');
    renderNav(); renderMain();
  } catch (error) {
    toast(`Could not remove kit: ${error.message}`, 'error');
  }
}

function editKitName(kitId) {
  const kit = getKit(kitId);
  const wrap = document.getElementById('kitNameDisplay_'+kitId);
  wrap.innerHTML = `
    <span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${kit.colour};flex-shrink:0;margin-right:4px;"></span>
    <div class="inline-edit-wrap" style="flex:1;flex-wrap:wrap;gap:6px;">
      <div style="display:flex;flex-direction:column;gap:4px;">
        <input type="text" class="inp" id="kn_${kitId}" value="${kit.name.replace(/"/g,'&quot;')}" placeholder="Full kit name" style="width:340px;font-weight:700;" onkeydown="if(event.key==='Enter')saveKitName('${kitId}');if(event.key==='Escape')renderMain();">
        <input type="text" class="inp inp-sm" id="ks_${kitId}" value="${(kit.short||'').replace(/"/g,'&quot;')}" placeholder="Short tab name (e.g. CRYO)" style="width:160px;" onkeydown="if(event.key==='Enter')saveKitName('${kitId}');if(event.key==='Escape')renderMain();">
      </div>
      <div style="display:flex;gap:5px;align-items:flex-start;margin-top:2px;">
        <button class="btn btn-accent btn-sm" onclick="saveKitName('${kitId}')">✓ Save</button>
        <button class="btn btn-outline btn-sm" onclick="renderMain()">× Cancel</button>
      </div>
    </div>`;
  document.getElementById('kn_'+kitId).focus();
  document.getElementById('kn_'+kitId).select();
}

async function saveKitName(kitId) {
  const fullName = (document.getElementById('kn_'+kitId).value || '').trim();
  const shortName = (document.getElementById('ks_'+kitId).value || '').trim();
  if (!fullName) { toast('Kit name cannot be empty','error'); return; }
  const kit = getKit(kitId);
  kit.name = fullName;
  if (shortName) kit.short = shortName;
  await commitChange(() => persistKit(kit), 'Kit renamed');
}

// ════════════════════════════════════════════════════
// FINAL STOCK TAB
// ════════════════════════════════════════════════════
function renderFinal() {
  // Only show products that are used in at least one kit OR have consumed > 0
  const allUsedCodes = new Set(S.kits.flatMap(k=>k.items.map(it=>it.productCode)));

  const rows = S.products.map(p => {
    const cons = consumed(p.code);
    const rem  = p.stock - cons;
    const pct  = p.stock > 0 ? Math.max(0,Math.min(100,Math.round((rem/p.stock)*100))) : 0;
    const barCol = rem<0?'var(--danger)':rem===0?'var(--warn)':'var(--ok)';
    const kitCols = S.kits.map(k=>{
      const kitCons = k.items.filter(it=>it.productCode==p.code).reduce((s,it)=>s+it.pcs*k.orderQty,0);
      return kitCons > 0 ? `<td style="text-align:right;color:var(--danger);font-weight:700;">−${N(kitCons)}</td>` : `<td style="text-align:right;color:var(--muted);">—</td>`;
    }).join('');
    return {rem, used: allUsedCodes.has(p.code)||cons>0, html:`<tr class="${rem<0?'row-danger':rem===0?'row-warn':''}">
      <td><span class="code-pill">${p.code}</span></td>
      <td style="font-weight:600;max-width:240px;">${p.name}</td>
      <td style="color:var(--text2);">${p.size||'—'}</td>
      <td style="color:var(--text2);">${p.material||'—'}</td>
      <td style="font-weight:700;text-align:right;">${N(p.stock)}</td>
      ${kitCols}
      <td style="text-align:right;font-weight:800;font-size:14px;color:${barCol};">
        ${rem<0?'⚠️ ':''} ${rem<0?'−'+N(Math.abs(rem)):N(rem)}
      </td>
      <td>
        <div>
          <div class="pbar-wrap"><div class="pbar" style="width:${pct}%;background:${barCol};"></div></div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;">${pct}% remaining</div>
        </div>
      </td>
    </tr>`};
  });

  const allRows = rows.filter(r=>true); // show all
  const dangerRows = rows.filter(r=>r.rem<0);
  const warnRows   = rows.filter(r=>r.rem===0);
  const okRows     = rows.filter(r=>r.rem>0);
  const unusedRows = rows.filter(r=>!r.used);

  const totalStock = S.products.reduce((s,p)=>s+p.stock,0);
  const totalCons  = S.products.reduce((s,p)=>s+consumed(p.code),0);

  return `
  <div class="sh">
    <div><div class="sh-title">✅ Final Stock Overview</div>
    <div class="sh-sub">Remaining quantity per product after subtracting all kit allocations from current stock</div></div>
    <button class="btn btn-outline btn-sm" onclick="exportCSV()">⬇️ Export CSV</button>
  </div>

  <div class="fs-summary">
    <div class="fs-stat" style="background:var(--info-bg);border:1px solid #BDE0F5;">
      <div class="fs-stat-icon">📦</div>
      <div><div class="fs-stat-label">Total Stock</div><div class="fs-stat-val" style="color:var(--info);">${N(totalStock)}</div></div>
    </div>
    <div class="fs-stat" style="background:#EEF0F3;border:1px solid var(--border);">
      <div class="fs-stat-icon">🏭</div>
      <div><div class="fs-stat-label">Total Consumed</div><div class="fs-stat-val" style="color:var(--text2);">${N(totalCons)}</div></div>
    </div>
    <div class="fs-stat" style="background:${dangerRows.length?'var(--danger-bg)':'var(--ok-bg)'};border:1px solid ${dangerRows.length?'#f5bcb8':'#A9DFBF'};">
      <div class="fs-stat-icon">${dangerRows.length?'🔴':'✅'}</div>
      <div><div class="fs-stat-label">Stock Shortfalls</div><div class="fs-stat-val" style="color:${dangerRows.length?'var(--danger)':'var(--ok)'};">${dangerRows.length}</div>
      <div style="font-size:12px;color:var(--text2);">products below zero</div></div>
    </div>
    <div class="fs-stat" style="background:var(--ok-bg);border:1px solid #A9DFBF;">
      <div class="fs-stat-icon">🟢</div>
      <div><div class="fs-stat-label">Sufficient Stock</div><div class="fs-stat-val" style="color:var(--ok);">${okRows.length}</div>
      <div style="font-size:12px;color:var(--text2);">products fully covered</div></div>
    </div>
  </div>

  ${dangerRows.length ? `<div style="background:var(--danger-bg);border:1px solid #f5bcb8;border-radius:11px;padding:14px 18px;margin-bottom:18px;display:flex;align-items:center;gap:12px;">
    <span style="font-size:22px;">🔴</span>
    <div>
      <div style="font-weight:800;color:var(--danger);font-size:14.5px;">${dangerRows.length} product${dangerRows.length>1?'s':''} exceed current stock</div>
      <div style="font-size:13px;color:var(--text2);margin-top:2px;">
        ${dangerRows.map(r=>{
          const p=S.products.find(x=>remaining(x.code)===r.rem);
          return p?p.name:'';
        }).filter(Boolean).join(' · ')}
      </div>
    </div>
  </div>`:''}

  <div class="card">
    <div class="card-hdr">
      Stock Balance — All Products
      <span class="card-hdr-right">
        🔴 Negative = shortfall &nbsp;·&nbsp; 🟡 Zero = exactly used up &nbsp;·&nbsp; 🟢 Positive = surplus
      </span>
    </div>
    <div class="tbl-wrap">
      <table>
        <thead><tr>
          <th>Code</th><th>Product Name</th><th>Size</th><th>Material</th>
          <th style="text-align:right;">Current Stock</th>
          ${S.kits.map(k=>`<th style="text-align:right;"><span style="width:8px;height:8px;border-radius:50%;background:${k.colour};display:inline-block;"></span> ${k.short}</th>`).join('')}
          <th style="text-align:right;">LEFT STOCK</th>
          <th>Progress</th>
        </tr></thead>
        <tbody>
          ${dangerRows.length?`<tr class="section-row"><td colspan="${7+S.kits.length}">🔴 SHORTFALL — Stock Insufficient</td></tr>`+''+dangerRows.map(r=>r.html).join(''):''}
          ${warnRows.length ?`<tr class="section-row"><td colspan="${7+S.kits.length}">🟡 FULLY CONSUMED — Zero Remaining</td></tr>`+warnRows.map(r=>r.html).join(''):''}
          ${okRows.length  ?`<tr class="section-row"><td colspan="${7+S.kits.length}">🟢 SURPLUS — Stock Remaining</td></tr>`+okRows.map(r=>r.html).join(''):''}
        </tbody>
      </table>
    </div>
  </div>`;
}

function exportCSV() {
  const headers = ['Code','Product Name','Size','Material','Current Stock',...S.kits.map(k=>k.short+' (used)'),'Left Stock'];
  const rows = S.products.map(p=>{
    const kitUsed = S.kits.map(k=>k.items.filter(it=>it.productCode==p.code).reduce((s,it)=>s+it.pcs*k.orderQty,0));
    const rem = p.stock - consumed(p.code);
    return [p.code, `"${p.name}"`, p.size||'', p.material||'', p.stock, ...kitUsed, rem];
  });
  const csv = [headers, ...rows].map(r=>r.join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'SeaSoul_Stock_Allocator_' + new Date().toISOString().slice(0,10) + '.csv';
  a.click();
  toast('CSV exported!','success');
}

// ════════════════════════════════════════════════════
// URGENT ORDER TAB
// ════════════════════════════════════════════════════
function renderUrgent() {
  const urgentProds = S.products.filter(p => {
    const ms = p.minStock || 0;
    return ms > 0 && remaining(p.code) < ms;
  });
  const urgentPkg = (S.packaging||[]).filter(p => (p.minQty||0) > 0 && remainingPkg(p) <= p.minQty);
  const urgentRM  = (S.rmItems||[]).filter(r => (r.minQty||0) > 0 && remainingRM(r) <= r.minQty);
  const totalUrgent = urgentProds.length + urgentPkg.length + urgentRM.length;

  if (totalUrgent === 0) {
    return `
    <div class="sh">
      <div><div class="sh-title">🚨 Urgent Order</div>
      <div class="sh-sub">Products, Packaging & Raw Materials where stock is at or below minimum threshold</div></div>
    </div>
    <div style="text-align:center;padding:60px 20px;">
      <div style="font-size:52px;margin-bottom:16px;">✅</div>
      <div style="font-size:18px;font-weight:800;color:var(--ok);">Everything is above minimum stock levels</div>
      <div style="font-size:13px;color:var(--muted);margin-top:6px;">Set Min Stock / Min Qty values on the Products, Packaging & Raw Materials tabs to start tracking reorder points.</div>
    </div>`;
  }

  const critical = urgentProds.filter(p => remaining(p.code) < 0);
  const low      = urgentProds.filter(p => remaining(p.code) >= 0);

  const makeProdRows = (list) => list.map(p => {
    const rem   = remaining(p.code);
    const ms    = p.minStock || 0;
    const short = ms - rem;
    const kitBreakdown = S.kits.map(k => {
      const kitCons = k.items.filter(it=>it.productCode==p.code).reduce((s,it)=>s+it.pcs*k.orderQty,0);
      return kitCons > 0 ? `<span style="font-size:11px;background:${k.colour}22;color:${k.colour};border-radius:4px;padding:2px 6px;font-weight:700;">${k.short}: −${N(kitCons)}</span>` : '';
    }).filter(Boolean).join(' ');
    return `<tr style="background:#fff5f5;">
      <td><span class="code-pill" style="background:var(--danger);">${p.code}</span></td>
      <td style="font-weight:700;max-width:240px;">${p.name}</td>
      <td style="color:var(--text2);">${p.size||'—'}</td>
      <td style="color:var(--text2);">${p.material||'—'}</td>
      <td style="font-weight:700;text-align:right;">${N(p.stock)}</td>
      <td style="text-align:right;font-weight:700;color:var(--danger);">${N(ms)}</td>
      <td style="text-align:right;font-weight:800;color:${rem<0?'var(--danger)':'var(--warn)'};">${rem<0?'−'+N(Math.abs(rem)):N(rem)}</td>
      <td style="text-align:right;"><span class="badge b-danger" style="font-size:13px;font-weight:900;">🔴 Need ${N(short)}</span></td>
      <td style="font-size:12px;">${kitBreakdown||'—'}</td>
    </tr>`;
  }).join('');

  const makePkgRows = (list) => list.map(p => {
    const mq   = p.minQty || 0;
    const cons = consumedPkgByCode(p.code);
    const rem  = p.stock - cons;
    const need = Math.max(0, mq - rem);
    return `<tr style="background:#fff5f5;">
      <td><span class="code-pill" style="font-size:11px;background:var(--danger);">${p.code||'—'}</span></td>
      <td style="font-weight:700;max-width:260px;">${p.name}</td>
      <td style="text-align:right;font-weight:700;">${N(p.stock)}</td>
      <td style="text-align:right;color:var(--danger);">${cons>0?'−'+N(cons):'—'}</td>
      <td style="text-align:right;font-weight:800;color:${rem<0?'var(--danger)':'var(--warn)'};">${rem<0?'−'+N(Math.abs(rem)):N(rem)}</td>
      <td style="text-align:right;font-weight:700;color:var(--danger);">${N(mq)}</td>
      <td style="text-align:right;"><span class="badge b-danger" style="font-size:13px;font-weight:900;">🔴 Need ${N(need)}</span></td>
      <td style="font-size:12px;">${p.kits||'—'}</td>
    </tr>`;
  }).join('');

  const makeRMRows = (list) => list.map(r => {
    const mq   = r.minQty || 0;
    const isKg = r.code && r.code.startsWith('RM');
    const cons = consumedRMByCode(r.code);
    const consAmt = isKg ? cons.kg : cons.pcs;
    const rem  = r.qtyKg - consAmt;
    const need = Math.max(0, mq - rem);
    const unit = isKg ? 'KG' : 'pcs';
    return `<tr style="background:#fff5f5;">
      <td>${r.code?`<span class="code-pill" style="font-size:11px;background:var(--danger);">${r.code}</span>`:'<span style="color:var(--muted)">—</span>'}</td>
      <td style="font-weight:700;">${r.name}</td>
      <td style="text-align:right;font-weight:700;">${N(r.qtyKg)} ${unit}</td>
      <td style="text-align:right;color:var(--danger);">${consAmt>0?'−'+(isKg?N(Math.round(consAmt*100)/100):N(consAmt))+' '+unit:'—'}</td>
      <td style="text-align:right;font-weight:800;color:${rem<0?'var(--danger)':'var(--warn)'};">${(rem<0?'−':'')+N(Math.abs(Math.round(rem*100)/100))} ${unit}</td>
      <td style="text-align:right;font-weight:700;color:var(--danger);">${N(mq)} ${unit}</td>
      <td style="text-align:right;"><span class="badge b-danger" style="font-size:13px;font-weight:900;">🔴 Need ${N(Math.round(need*100)/100)} ${unit}</span></td>
    </tr>`;
  }).join('');

  return `
  <div class="sh">
    <div><div class="sh-title">🚨 Urgent Order</div>
    <div class="sh-sub">${totalUrgent} item${totalUrgent>1?'s':''} need reordering across Products, Packaging & Raw Materials</div></div>
  </div>

  <div class="fs-summary" style="margin-bottom:20px;">
    <div class="fs-stat" style="background:var(--danger-bg);border:1px solid #f5bcb8;">
      <div class="fs-stat-icon">🔴</div>
      <div><div class="fs-stat-label">Critical — Negative / Zero Stock</div><div class="fs-stat-val" style="color:var(--danger);">${critical.length}</div>
      <div style="font-size:12px;color:var(--text2);">products exhausted</div></div>
    </div>
    <div class="fs-stat" style="background:var(--warn-bg);border:1px solid #f5c97a;">
      <div class="fs-stat-icon">⚠️</div>
      <div><div class="fs-stat-label">Low — Below Min Stock</div><div class="fs-stat-val" style="color:var(--warn);">${low.length}</div>
      <div style="font-size:12px;color:var(--text2);">products below threshold</div></div>
    </div>
    <div class="fs-stat" style="background:#EEE8F3;border:1px solid #c3aad8;">
      <div class="fs-stat-icon">📦</div>
      <div><div class="fs-stat-label">Packaging Low</div><div class="fs-stat-val" style="color:#6C3483;">${urgentPkg.length}</div>
      <div style="font-size:12px;color:var(--text2);">packaging items at/below min</div></div>
    </div>
    <div class="fs-stat" style="background:#FEF3E2;border:1px solid #f5c97a;">
      <div class="fs-stat-icon">🧪</div>
      <div><div class="fs-stat-label">Raw Materials Low</div><div class="fs-stat-val" style="color:#B7770D;">${urgentRM.length}</div>
      <div style="font-size:12px;color:var(--text2);">RM items at/below min</div></div>
    </div>
  </div>

  ${critical.length ? `
  <div class="card" style="border:2px solid var(--danger);margin-bottom:18px;">
    <div class="card-hdr" style="background:var(--danger-bg);color:var(--danger);">🔴 CRITICAL — Product Stock Exhausted or Negative</div>
    <div class="tbl-wrap"><table>
      <thead><tr style="background:#fdecea;">
        <th>Code</th><th>Product Name</th><th>Size</th><th>Material</th>
        <th style="text-align:right;">Current Stock</th><th style="text-align:right;">Min Stock</th>
        <th style="text-align:right;">Remaining</th><th style="text-align:right;">Units to Order</th><th>Kit Usage</th>
      </tr></thead>
      <tbody>${makeProdRows(critical)}</tbody>
    </table></div>
  </div>` : ''}

  ${low.length ? `
  <div class="card" style="border:2px solid var(--warn);margin-bottom:18px;">
    <div class="card-hdr" style="background:var(--warn-bg);color:#9a5100;">⚠️ LOW STOCK — Products Below Minimum Threshold</div>
    <div class="tbl-wrap"><table>
      <thead><tr style="background:#fef5e7;">
        <th>Code</th><th>Product Name</th><th>Size</th><th>Material</th>
        <th style="text-align:right;">Current Stock</th><th style="text-align:right;">Min Stock</th>
        <th style="text-align:right;">Remaining</th><th style="text-align:right;">Units to Order</th><th>Kit Usage</th>
      </tr></thead>
      <tbody>${makeProdRows(low)}</tbody>
    </table></div>
  </div>` : ''}

  ${urgentPkg.length ? `
  <div class="card" style="border:2px solid #8E44AD;margin-bottom:18px;">
    <div class="card-hdr" style="background:#EEE8F3;color:#6C3483;">📦 PACKAGING — At or Below Minimum Quantity</div>
    <div class="tbl-wrap"><table>
      <thead><tr style="background:#F5EEF8;">
        <th>PM Code</th><th>Packaging Name</th>
        <th style="text-align:right;">Current Stock</th><th style="text-align:right;">Used by Kits</th>
        <th style="text-align:right;">Remaining</th><th style="text-align:right;">Min Qty</th>
        <th style="text-align:right;">To Order</th><th>Linked Kits</th>
      </tr></thead>
      <tbody>${makePkgRows(urgentPkg)}</tbody>
    </table></div>
  </div>` : ''}

  ${urgentRM.length ? `
  <div class="card" style="border:2px solid #B7770D;">
    <div class="card-hdr" style="background:#FEF3E2;color:#B7770D;">🧪 RAW MATERIALS — At or Below Minimum Quantity</div>
    <div class="tbl-wrap"><table>
      <thead><tr style="background:#FEF9ED;">
        <th>RM Code</th><th>Material Name</th>
        <th style="text-align:right;">Current Qty</th><th style="text-align:right;">Used by Kits</th>
        <th style="text-align:right;">Remaining</th><th style="text-align:right;">Min Qty</th>
        <th style="text-align:right;">To Order</th>
      </tr></thead>
      <tbody>${makeRMRows(urgentRM)}</tbody>
    </table></div>
  </div>` : ''}`;
}

// ════════════════════════════════════════════════════
// ADD KIT MODAL
// ════════════════════════════════════════════════════
function openAddKitModal() {
  document.getElementById('nkName').value='';
  document.getElementById('nkShort').value='';
  document.getElementById('nkQty').value='500';
  S._selColour = S._kitColours[S.kits.length % S._kitColours.length];
  document.getElementById('nkColour').value = S._selColour;
  const cp = document.getElementById('kitColourPicker');
  cp.innerHTML = S._kitColours.map(c=>`<div onclick="pickKitColour('${c}')" style="width:28px;height:28px;border-radius:50%;background:${c};cursor:pointer;border:3px solid ${S._selColour===c?'white':'transparent'};box-shadow:${S._selColour===c?'0 0 0 2px '+c:'none'};transition:all .15s;" id="kcp_${c.replace('#','')}"></div>`).join('');
  openModal('addKitModal');
  setTimeout(()=>document.getElementById('nkName').focus(),120);
}

function pickKitColour(c) {
  S._selColour = c;
  document.getElementById('nkColour').value = c;
  S._kitColours.forEach(col=>{
    const el=document.getElementById('kcp_'+col.replace('#',''));
    if(el){el.style.border=`3px solid ${S._selColour===col?'white':'transparent'}`;el.style.boxShadow=S._selColour===col?'0 0 0 2px '+col:'none';}
  });
}

async function confirmAddKit() {
  const name = document.getElementById('nkName').value.trim();
  if(!name){toast('Please enter a kit name','error');return;}
  const short = document.getElementById('nkShort').value.trim() || name.split(' ').slice(0,2).join(' ');
  const qty   = parseInt(document.getElementById('nkQty').value)||500;
  const kit = { _docId: 'k' + S.nextKitId++, id: '', name, short, colour:S._selColour, orderQty:qty, items:[] };
  kit.id = kit._docId;
  try {
    await setDoc(doc(db, 'kits', kit.id), { name: kit.name, short: kit.short, colour: kit.colour, orderQty: kit.orderQty });
    S.kits.push(kit);
  } catch (error) {
    toast(`Could not add kit: ${error.message}`, 'error');
    return;
  }
  toast(`"${name}" added!`,'success');
  closeModal('addKitModal');
  S.activeTab = S.kits[S.kits.length-1].id;
  renderNav(); renderMain();
}

// ════════════════════════════════════════════════════
// ADD PRODUCT TO KIT MODAL
// ════════════════════════════════════════════════════
function openAddKitItemModal(kitId) {
  S._editKitId = kitId;
  document.getElementById('akiCodeInput').value = '';
  document.getElementById('akiProductPreview').style.display = 'none';
  document.getElementById('akiProductPreview').innerHTML = '';
  document.getElementById('akiCodeError').style.display = 'none';
  document.getElementById('akiStep').value='';
  document.getElementById('akiPcs').value='6';
  document.getElementById('akiSection').value='Main Kit';
  openModal('addKitItemModal');
  setTimeout(()=>document.getElementById('akiCodeInput').focus(), 100);
}

function lookupAkiCode() {
  const code = document.getElementById('akiCodeInput').value.trim();
  const preview = document.getElementById('akiProductPreview');
  const err = document.getElementById('akiCodeError');
  if (!code) { preview.style.display='none'; err.style.display='none'; return; }
  const p = S.products.find(pr => pr.code == code);
  if (p) {
    err.style.display = 'none';
    preview.innerHTML = `
      <div style="font-weight:600;color:#1a3a5c;margin-bottom:4px;">[${p.code}] ${p.name}</div>
      <div style="color:#555;">
        <span style="margin-right:16px;">📐 Size: <strong>${p.size||'—'}</strong></span>
        <span style="margin-right:16px;">🧪 Material: <strong>${p.material||'—'}</strong></span>
        <span>📦 Stock: <strong>${p.stock.toLocaleString()}</strong></span>
      </div>`;
    preview.style.display = 'block';
  } else {
    preview.style.display = 'none';
    err.style.display = code.length > 0 ? 'block' : 'none';
  }
}

async function confirmAddKitItem() {
  const kit = getKit(S._editKitId);
  const code = document.getElementById('akiCodeInput').value.trim();
  const p = S.products.find(pr => pr.code == code);
  if (!p) { toast('Enter a valid product code first','error'); return; }
  const section = document.getElementById('akiSection').value;
  const step  = document.getElementById('akiStep').value.trim();
  const pcs   = parseInt(document.getElementById('akiPcs').value)||1;
  kit.items.push({productCode:p.code, step, pcs, section, comment:p.name});
  try {
    await persistKitItems(kit);
  } catch (error) {
    kit.items.pop();
    toast(`Could not add product to kit: ${error.message}`, 'error');
    return;
  }
  toast(`${p.name} added to kit`,'success');
  closeModal('addKitItemModal');
  renderMain(); renderNav();
}

// ════════════════════════════════════════════════════
// MODAL HELPERS
// ════════════════════════════════════════════════════
function openModal(id) {document.getElementById(id).classList.add('open');}
function closeModal(id){document.getElementById(id).classList.remove('open');}
document.querySelectorAll('.modal-bg').forEach(el=>el.addEventListener('click',e=>{if(e.target===el)el.classList.remove('open');}));
document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.modal-bg.open').forEach(m=>m.classList.remove('open'));});

Object.assign(window, {
  switchTab, addProduct, filterProducts, clearProdSearch, pkgSearchInputChanged, clearPkgSearch,
  editPMCode, savePMCode, editName, saveName, editSize, saveSize, editMat, saveMat,
  editMinStock, saveMinStock, editStock, saveStock, deleteProd,
  editPkgCode, savePkgCode, editPkgStock, savePkgStock, editPkgMin, savePkgMin,
  editRMCode, saveRMCode, editRMQty, saveRMQty, editRMMin, saveRMMin,
  editKitPkgCode, saveKitPkgCode, editKitRMCode, saveKitRMCode,
  editPcs, savePcs, removeKitItem, updateOrderQty, deleteKit, editKitName, saveKitName,
  exportCSV, openAddKitModal, pickKitColour, confirmAddKit, openAddKitItemModal,
  lookupAkiCode, confirmAddKitItem, openModal, closeModal, renderMain
});

// ════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════
  document.getElementById('hdrDate').innerHTML = `<strong>${fmtD()}</strong>`;

// Simple CSV parser that handles quoted fields
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  return lines.map(line => {
    const cols = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === ',' && !inQuotes) { cols.push(cur); cur = ''; continue; }
      cur += ch;
    }
    cols.push(cur);
    return cols.map(c => c.trim());
  });
}

async function loadDelimitedData(path) {
  const resp = await fetch(path);
  if (!resp.ok) return [];
  const txt = await resp.text();
  const rows = parseCSV(txt);
  if (!rows.length) return [];
  const headers = rows[0].map(h => h.toLowerCase());
  return rows.slice(1).filter(row => row.length).map(row => {
    const obj = {};
    for (let i = 0; i < headers.length; i++) obj[headers[i]] = row[i] || '';
    return obj;
  });
}

function finalizeLoadedData() {
  S.products.forEach(p => {
    if (!p.pmCode) {
      const fallback = PM_CODE_MAP[String(p.code)] || (Number.isFinite(Number(p.code)) ? `PM-${(700 + Number(p.code)).toString().padStart(5, '0')}` : '');
      p.pmCode = fallback;
    }
  });
  S.packaging.forEach((p, i) => {
    p._pkgId = i;
    if (p.minQty === undefined) p.minQty = 0;
  });
  S.rmItems.forEach((r, i) => {
    r._rmId = i;
    if (r.minQty === undefined) r.minQty = 0;
  });
}

function showAuthError(message) {
  const error = document.getElementById('loginError');
  error.textContent = message;
  error.style.display = 'block';
}

async function loadFirestoreData() {
  try {
    const [productSnapshot, kitSnapshot, packagingSnapshot, rawMaterialSnapshot] = await Promise.all([
      getDocs(collection(db, 'products')),
      getDocs(collection(db, 'kits')),
      getDocs(collection(db, 'packaging')),
      getDocs(collection(db, 'rawMaterials'))
    ]);

    S.products = productSnapshot.docs.map(snapshot => {
      const obj = snapshot.data();
      return { _docId: snapshot.id, id: obj.id || snapshot.id, code: obj.code || snapshot.id, name: obj.name || '', size: obj.size || '', material: obj.material || '', stock: Number(obj.stock) || 0, minStock: Number(obj.minStock) || 0, pmCode: (obj.pmCode || '').toUpperCase() };
    });
    S.kits = kitSnapshot.docs.map(snapshot => {
      const obj = snapshot.data();
      return { _docId: snapshot.id, id: snapshot.id, name: obj.name || '', short: obj.short || '', colour: obj.colour || obj.color || '#2471A3', orderQty: Number(obj.orderQty) || 500, items: [] };
    });
    S.packaging = packagingSnapshot.docs.map(snapshot => {
      const obj = snapshot.data();
      return { _docId: snapshot.id, code: obj.code || snapshot.id, name: obj.name || '', stock: Number(obj.stock) || 0, kits: obj.kits || '', minQty: Number(obj.minQty) || 0 };
    });
    S.rmItems = rawMaterialSnapshot.docs.map(snapshot => {
      const obj = snapshot.data();
      return { _docId: snapshot.id, code: obj.code || snapshot.id, name: obj.name || '', qtyKg: Number(obj.qtyKg) || 0, minQty: Number(obj.minQty) || 0 };
    });

    Object.keys(MASTER_NAME_MAP).forEach(k => delete MASTER_NAME_MAP[k]);
    S.products.forEach(p => { MASTER_NAME_MAP[normKey(p.name)] = p; });
    S.packaging.forEach(p => { MASTER_NAME_MAP[normKey(p.name)] = p; });
    S.rmItems.forEach(r => { MASTER_NAME_MAP[normKey(r.name)] = r; });

    const rmStockOverrides = {
      'Silk Mask Sheet': 0,
      'Glass Mask Sheet': 0,
    };
    S.rmItems.forEach(r => {
      if (r.name in rmStockOverrides) r.qtyKg = rmStockOverrides[r.name];
    });

    await Promise.all(S.kits.map(async kit => {
      const itemSnapshot = await getDocs(collection(db, 'kits', kit.id, 'items'));
      const grouped = new Map();
      itemSnapshot.docs.forEach(snapshot => {
        const row = snapshot.data();
        const productCode = row.productCode || '';
        if (!productCode) return;
        const current = grouped.get(productCode);
        if (!current) grouped.set(productCode, { _docId: snapshot.id, productCode, step: row.step || '', pcs: Number(row.pcs) || 1, section: row.section || 'Main Kit', comment: row.comment || '' });
        else current.pcs += Number(row.pcs) || 1;
      });
      kit.items = Array.from(grouped.values());
    }));

    S.kits.forEach(kit => { if (!KIT_MATERIALS[kit.id]) KIT_MATERIALS[kit.id] = { pkg: [], rm: [] }; });

    finalizeLoadedData();
    renderNav(); renderMain();
  } catch (e) {
    console.error('Firestore load failed', e);
    toast('Could not load data from Firestore', 'error');
  }
}

document.getElementById('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = document.getElementById('loginButton');
  button.disabled = true;
  try {
    await signInWithEmailAndPassword(auth, document.getElementById('loginEmail').value.trim(), document.getElementById('loginPassword').value);
    document.getElementById('loginForm').reset();
    showAuthError('');
  } catch (error) {
    showAuthError(error.code === 'auth/invalid-credential' ? 'Email or password is incorrect.' : error.message);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('logoutButton').addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, async user => {
  currentUser = user;
  const gate = document.getElementById('authGate');
  const logoutButton = document.getElementById('logoutButton');
  if (!user) {
    gate.classList.add('open');
    logoutButton.style.display = 'none';
    return;
  }
  const token = await getIdTokenResult(user);
  if (token.claims.allowed !== true) {
    await signOut(auth);
    showAuthError('This account is not authorised to use the application.');
    return;
  }
  gate.classList.remove('open');
  logoutButton.style.display = 'block';
  await loadFirestoreData();
});