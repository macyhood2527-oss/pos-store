let productsCache = [];
let selectedProduct = null;

const statusEl = document.getElementById("status");
const tbody = document.getElementById("productsTbody");
const searchEl = document.getElementById("search");
const selectedBox = document.getElementById("selectedBox");

const stockInBtn = document.getElementById("stockInBtn");
const priceBtn = document.getElementById("priceBtn");
const movementsRefreshBtn = document.getElementById("movementsRefreshBtn");
const movementsList = document.getElementById("movementsList");

function setStatus(msg) {
  statusEl.textContent = msg;
}

function money(v) {
  const n = Number(v ?? 0);
  return `₱${n.toFixed(2)}`;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

// -------- API --------
async function apiGet(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function apiSend(url, method, body) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// -------- UI Render --------
function renderProducts(list) {
  tbody.innerHTML = "";

  list.forEach((p) => {
    const lowStock = Number(p.stock) <= Number(p.reorder_level);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${p.id}</td>
      <td>${esc(p.sku)}</td>
      <td>${esc(p.barcode || "-")}</td>
      <td>${esc(p.name)}</td>
      <td>${money(p.current_price)}</td>
      <td>
        ${p.stock}
        ${lowStock ? `<span class="badge">LOW</span>` : ""}
      </td>
      <td>${p.reorder_level}</td>
      <td>
        <div class="actions">
          <button class="secondary" data-action="select" data-id="${p.id}">Select</button>
          <button class="secondary" data-action="delete" data-id="${p.id}">Delete</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderSelected() {
  if (!selectedProduct) {
    selectedBox.innerHTML = `<div class="muted">No product selected</div>`;
    stockInBtn.disabled = true;
    priceBtn.disabled = true;
    movementsRefreshBtn.disabled = true;
    movementsList.innerHTML = `<div class="muted">Select a product to view movements</div>`;
    return;
  }

  selectedBox.innerHTML = `
    <div><b>${esc(selectedProduct.name)}</b></div>
    <div class="small muted">SKU: ${esc(selectedProduct.sku)}</div>
    <div class="small muted">Barcode: ${esc(selectedProduct.barcode || "-")}</div>
    <div class="small muted">Stock: ${selectedProduct.stock}</div>
    <div class="small muted">Price: ${money(selectedProduct.current_price)}</div>
  `;

  stockInBtn.disabled = false;
  priceBtn.disabled = false;
  movementsRefreshBtn.disabled = false;
}

function renderMovements(rows) {
  if (!rows.length) {
    movementsList.innerHTML = `<div class="muted">No movements yet</div>`;
    return;
  }

  movementsList.innerHTML = rows.map((m) => `
    <div class="card" style="margin:10px 0; padding:12px;">
      <div class="cardHead" style="margin-bottom:6px;">
        <div><b>${m.type}</b> • Qty: ${m.qty}</div>
        <div class="small muted">#${m.id}</div>
      </div>
      <div class="small muted">Unit Cost: ${m.unit_cost === null ? "-" : money(m.unit_cost)}</div>
      <div class="small muted">Note: ${esc(m.note || "-")}</div>
      <div class="small muted">Ref: ${esc(m.ref_type || "-")} ${m.ref_id ?? ""}</div>
      <div class="small muted">${new Date(m.created_at).toLocaleString()}</div>
    </div>
  `).join("");
}

// -------- Actions --------
async function loadProducts() {
  setStatus("Loading products...");
  const products = await apiGet("/products");
  productsCache = products;
  applyFilter();
  setStatus(`Loaded ${products.length} product(s) ✅`);

  // keep selected updated
  if (selectedProduct) {
    selectedProduct = productsCache.find(p => p.id === selectedProduct.id) || null;
    renderSelected();
  }
}

function applyFilter() {
  const q = searchEl.value.trim().toLowerCase();
  const list = !q
    ? productsCache
    : productsCache.filter(p =>
        String(p.sku).toLowerCase().includes(q) ||
        String(p.barcode || "").toLowerCase().includes(q) ||
        String(p.name).toLowerCase().includes(q)
      );

  renderProducts(list);
}

async function selectProduct(id) {
  selectedProduct = productsCache.find(p => p.id === id) || null;
  renderSelected();
  if (selectedProduct) await loadMovements();
}

async function loadMovements() {
  if (!selectedProduct) return;
  setStatus("Loading movements...");
  const rows = await apiGet(`/products/${selectedProduct.id}/movements`);
  renderMovements(rows);
  setStatus("Movements loaded ✅");
}

async function deleteProduct(id) {
  const p = productsCache.find(x => x.id === id);
  if (!p) return;

  if (!confirm(`Delete product "${p.name}"?`)) return;

  setStatus("Deleting...");
  await apiSend(`/products/${id}`, "DELETE");

  if (selectedProduct && selectedProduct.id === id) selectedProduct = null;

  renderSelected();
  await loadProducts();
  setStatus("Deleted ✅");
}

// -------- Event Listeners --------
document.getElementById("refreshBtn").addEventListener("click", () => {
  loadProducts().catch(e => setStatus(e.message));
});

searchEl.addEventListener("input", applyFilter);

tbody.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;

  const id = Number(btn.dataset.id);
  const action = btn.dataset.action;

  if (action === "select") selectProduct(id).catch(err => setStatus(err.message));
  if (action === "delete") deleteProduct(id).catch(err => setStatus(err.message));
});

document.getElementById("productForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;

  try {
    setStatus("Creating product...");
    await apiSend("/products", "POST", {
      sku: f.sku.value,
      barcode: f.barcode.value,
      name: f.name.value,
      category: f.category.value,
      current_price: f.current_price.value,
      reorder_level: f.reorder_level.value,
    });

    f.reset();
    await loadProducts();
    setStatus("Product created ✅");
  } catch (err) {
    setStatus(err.message);
  }
});

document.getElementById("stockInForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!selectedProduct) return;

  const f = e.target;

  try {
    setStatus("Adding stock...");
    await apiSend(`/products/${selectedProduct.id}/stock-in`, "POST", {
      qty: f.qty.value,
      unit_cost: f.unit_cost.value,
      note: f.note.value,
    });

    f.reset();
    await loadProducts();
    await loadMovements();
    setStatus("Stock added ✅");
  } catch (err) {
    setStatus(err.message);
  }
});

document.getElementById("priceForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!selectedProduct) return;

  const f = e.target;

  try {
    setStatus("Updating price...");
    await apiSend(`/products/${selectedProduct.id}/price`, "PATCH", {
      new_price: f.new_price.value,
    });

    f.reset();
    await loadProducts();
    setStatus("Price updated ✅");
  } catch (err) {
    setStatus(err.message);
  }
});

movementsRefreshBtn.addEventListener("click", () => {
  loadMovements().catch(e => setStatus(e.message));
});

// init
loadProducts().catch(e => setStatus(e.message));
renderSelected();
