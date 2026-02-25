const statusEl = document.getElementById("status");
const rangeForm = document.getElementById("rangeForm");

const startEl = document.getElementById("start");
const endEl = document.getElementById("end");
const limitEl = document.getElementById("limit");

const summaryBox = document.getElementById("summaryBox");
const dailyTbody = document.getElementById("dailyTbody");
const lowStockTbody = document.getElementById("lowStockTbody");
const topTbody = document.getElementById("topTbody");
const lowStockBtn = document.getElementById("lowStockBtn");

const printDailyBtn = document.getElementById("printDailyBtn");
const csvBtn = document.getElementById("csvBtn");


function todayYMD() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// set defaults on load
startEl.value = startEl.value || todayYMD();
endEl.value   = endEl.value   || todayYMD();


function setStatus(msg) { statusEl.textContent = msg; }
function money(v){ return `₱${Number(v||0).toFixed(2)}`; }
function esc(s){ return String(s??"").replace(/[&<>"']/g,c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }

async function apiGet(url){
  const res = await fetch(url);
  const data = await res.json().catch(()=> ({}));
  if(!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function setDefaultDates(){
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth()+1).padStart(2,"0");
  const dd = String(today.getDate()).padStart(2,"0");
  const ymd = `${yyyy}-${mm}-${dd}`;
  startEl.value = ymd;
  endEl.value = ymd;
}

function updatePrintDailyLink() {
  const d = startEl.value;
  printDailyBtn.href = `/reports/daily-print?date=${d}`;
}

startEl.addEventListener("change", updatePrintDailyLink);
updatePrintDailyLink(); // ← important

function updateCsvLink() {
  const start = startEl.value;
  const end = endEl.value;
  csvBtn.href = `/reports/sales.csv?start=${start}&end=${end}`;
}

startEl.addEventListener("change", updateCsvLink);
endEl.addEventListener("change", updateCsvLink);
updateCsvLink();



async function loadLowStock(){
  setStatus("Loading low stock...");
  const data = await apiGet("/reports/low-stock");
  lowStockTbody.innerHTML = data.rows.map(r => `
    <tr>
      <td>${esc(r.sku)}</td>
      <td>${esc(r.name)}</td>
      <td>${r.stock}</td>
      <td>${r.reorder_level}</td>
    </tr>
  `).join("");
  setStatus(`Low stock loaded (${data.count}) ✅`);
}

rangeForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const start = startEl.value;
  const end = endEl.value;
  const limit = Number(limitEl.value || 10);

  try{
    setStatus("Running reports...");

    const summary = await apiGet(`/reports/sales-summary?start=${start}&end=${end}`);
    summaryBox.innerHTML = `
      <div><b>Transactions:</b> ${summary.transactions}</div>
      <div><b>Items Sold:</b> ${summary.items_sold}</div>
      <div><b>Subtotal:</b> ${money(summary.subtotal)}</div>
      <div><b>Discount:</b> ${money(summary.discount)}</div>
      <div><b>Total Sales:</b> ${money(summary.total_sales)}</div>
    `;

    const daily = await apiGet(`/reports/daily-sales?start=${start}&end=${end}`);
    dailyTbody.innerHTML = daily.days.map(d => `
      <tr>
        <td>${d.day}</td>
        <td>${d.transactions}</td>
        <td>${money(d.total_sales)}</td>
      </tr>
    `).join("");

    const top = await apiGet(`/reports/top-products?start=${start}&end=${end}&limit=${limit}`);
    topTbody.innerHTML = top.rows.map(r => `
      <tr>
        <td>${esc(r.sku_snapshot)}</td>
        <td>${esc(r.name_snapshot)}</td>
        <td>${r.qty_sold}</td>
        <td>${money(r.revenue)}</td>
      </tr>
    `).join("");

    setStatus("Reports ready ✅");
  } catch(err){
    setStatus(err.message);
  }
});

lowStockBtn.addEventListener("click", () => {
  loadLowStock().catch(e => setStatus(e.message));
});

// init
setDefaultDates();
loadLowStock().catch(e => setStatus(e.message));
