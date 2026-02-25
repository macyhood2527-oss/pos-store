require("dotenv").config();
console.log("🔥 server.js started");

const express = require("express");
const path = require("path");
const db = require("./db");

const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
const PORT = 3000;

// ✅ Declare ONCE only
const JWT_SECRET = "change-this-to-a-long-secret"; // later put in .env

// ✅ middleware FIRST (before any routes)
app.use(express.json());
app.use(cookieParser());

// ✅ Keep for CSS/JS/images, but protect HTML via sendFile routes below
app.use(express.static("public"));

/* =========================
   AUTH HELPERS
========================= */
function authRequired(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: "Not logged in" });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid session" });
  }
}

function roleRequired(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Not logged in" });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "Forbidden" });
    next();
  };
}

/* =========================
   AUTH ROUTES (ONCE ONLY)
========================= */
app.post("/auth/login", (req, res) => {
  const { username, password } = req.body;

  db.query(
    "SELECT id, username, password_hash, role, is_active FROM users WHERE username = ? LIMIT 1",
    [String(username || "").trim()],
    (err, rows) => {
      if (err) return res.status(500).json({ error: "Database error" });
      if (!rows.length) return res.status(401).json({ error: "Invalid credentials" });

      const u = rows[0];
      if (!u.is_active) return res.status(403).json({ error: "User disabled" });

      const ok = bcrypt.compareSync(String(password || ""), u.password_hash);
      if (!ok) return res.status(401).json({ error: "Invalid credentials" });

      const token = jwt.sign(
        { id: u.id, username: u.username, role: u.role },
        JWT_SECRET,
        { expiresIn: "7d" }
      );

      res.cookie("token", token, { httpOnly: true, sameSite: "lax" });
      res.json({ ok: true, user: { id: u.id, username: u.username, role: u.role } });
    }
  );
});

app.post("/auth/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ ok: true });
});

app.get("/auth/me", authRequired, (req, res) => {
  res.json({ ok: true, user: req.user });
});

/* =========================
   HEALTH + DB TEST
========================= */
app.get("/health", (req, res) => {
  res.json({ ok: true, message: "POS Store server running ✅" });
});

app.get("/db-test", (req, res) => {
  db.query("SELECT 1 AS ok", (err, rows) => {
    if (err) {
      console.error("DB error:", err);
      return res.status(500).json({ error: "DB connection failed" });
    }
    res.json({ ok: true, rows });
  });
});

/* =========================
   PROTECTED PAGES
========================= */
app.get("/", (req, res) => res.redirect("/login.html"));

app.get("/pos.html", authRequired, roleRequired("cashier", "admin"), (req, res) => {
  res.sendFile(path.join(__dirname, "public", "pos.html"));
});

app.get("/inventory.html", authRequired, roleRequired("admin"), (req, res) => {
  res.sendFile(path.join(__dirname, "public", "inventory.html"));
});

app.get("/reports.html", authRequired, roleRequired("admin"), (req, res) => {
  res.sendFile(path.join(__dirname, "public", "reports.html"));
});

app.get("/receipt.html", authRequired, roleRequired("cashier", "admin"), (req, res) => {
  res.sendFile(path.join(__dirname, "public", "receipt.html"));
});


/* =========================
   PRODUCTS
========================= */

// GET all products (Admin only)
app.get("/products", authRequired, roleRequired("admin"), (req, res) => {
  const sql = `
    SELECT id, sku, barcode, name, category, current_price, stock, reorder_level, is_active, created_at
    FROM products
    ORDER BY id DESC
  `;
  db.query(sql, (err, rows) => {
    if (err) {
      console.error("DB error:", err);
      return res.status(500).json({ error: "Database error" });
    }
    res.json(rows);
  });
});

// CREATE product (Admin only)
app.post("/products", authRequired, roleRequired("admin"), (req, res) => {
  const { sku, barcode, name, category, current_price, reorder_level, is_active } = req.body;

  if (!sku || !name) return res.status(400).json({ error: "sku and name are required" });

  const sql = `
    INSERT INTO products (sku, barcode, name, category, current_price, reorder_level, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  db.query(
    sql,
    [
      String(sku).trim(),
      barcode ? String(barcode).trim() : null,
      String(name).trim(),
      category ? String(category).trim() : null,
      Number(current_price ?? 0),
      Number(reorder_level ?? 5),
      Number(is_active ?? 1) ? 1 : 0,
    ],
    (err, result) => {
      if (err) {
        console.error("DB error:", err);
        if (err.code === "ER_DUP_ENTRY") {
          return res.status(409).json({ error: "SKU or Barcode already exists" });
        }
        return res.status(500).json({ error: "Database error" });
      }
      res.status(201).json({ message: "Product created", productId: result.insertId });
    }
  );
});

// DELETE product (Admin only)
app.delete("/products/:id", authRequired, roleRequired("admin"), (req, res) => {
  const productId = Number(req.params.id);
  if (!productId || productId <= 0) return res.status(400).json({ error: "Invalid product id" });

  db.query("DELETE FROM products WHERE id = ?", [productId], (err, result) => {
    if (err) {
      console.error("DB error:", err);
      return res.status(500).json({ error: "Database error" });
    }
    if (result.affectedRows === 0) return res.status(404).json({ error: "Product not found" });
    res.json({ message: "Product deleted" });
  });
});

// LOOKUP by SKU or BARCODE (Cashier + Admin)
app.get("/products/lookup", authRequired, roleRequired("cashier", "admin"), (req, res) => {
  const code = String(req.query.code || "").trim();
  if (!code) return res.status(400).json({ error: "code is required" });

  const sql = `
    SELECT id, sku, barcode, name, category, current_price, stock, reorder_level, is_active
    FROM products
    WHERE barcode = ? OR sku = ?
    ORDER BY (barcode = ?) DESC
    LIMIT 1
  `;

  db.query(sql, [code, code, code], (err, rows) => {
    if (err) {
      console.error("DB error:", err);
      return res.status(500).json({ error: "Database error" });
    }
    if (!rows.length) return res.status(404).json({ error: "Item not found" });

    const p = rows[0];
    if (Number(p.is_active) !== 1) return res.status(400).json({ error: "Item is inactive" });

    res.json(p);
  });
});

/* =========================
   STOCK IN (Admin only)
========================= */
app.post("/products/:id/stock-in", authRequired, roleRequired("admin"), (req, res) => {
  const productId = Number(req.params.id);
  const { qty, unit_cost, note } = req.body;

  if (!productId || productId <= 0) {
    return res.status(400).json({ error: "Invalid product id" });
  }

  const quantity = Number(qty);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return res.status(400).json({ error: "qty must be a number > 0" });
  }

  const cost =
    unit_cost === undefined || unit_cost === null || unit_cost === ""
      ? null
      : Number(unit_cost);

  if (cost !== null && (!Number.isFinite(cost) || cost < 0)) {
    return res.status(400).json({ error: "unit_cost must be >= 0" });
  }

  // 1) Update product stock
  db.query(
    "UPDATE products SET stock = stock + ? WHERE id = ?",
    [quantity, productId],
    (err, result) => {
      if (err) {
        console.error("DB error:", err);
        return res.status(500).json({ error: "Database error" });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Product not found" });
      }

      // 2) Log stock movement
      db.query(
        `
        INSERT INTO stock_movements
          (product_id, type, qty, unit_cost, note, ref_type, ref_id)
        VALUES (?, 'IN', ?, ?, ?, 'STOCK_IN', NULL)
        `,
        [productId, quantity, cost, note || null],
        (err2) => {
          if (err2) {
            console.error("DB error:", err2);
            return res.status(500).json({ error: "Database error" });
          }

          res.json({
            message: "Stock added ✅",
            productId,
            qty: quantity,
          });
        }
      );
    }
  );
});

/* =========================
   STOCK MOVEMENTS (Admin only)
========================= */
app.get("/products/:id/movements", authRequired, roleRequired("admin"), (req, res) => {
  const productId = Number(req.params.id);

  if (!productId || productId <= 0) {
    return res.status(400).json({ error: "Invalid product id" });
  }

  db.query(
    `
    SELECT id, product_id, type, qty, unit_cost, note, ref_type, ref_id, created_at
    FROM stock_movements
    WHERE product_id = ?
    ORDER BY id DESC
    LIMIT 200
    `,
    [productId],
    (err, rows) => {
      if (err) {
        console.error("DB error:", err);
        return res.status(500).json({ error: "Database error" });
      }
      res.json(rows);
    }
  );
});

/* =========================
   SALES (Cashier + Admin)
========================= */

// helper: generate receipt no like 20260130-000123
function pad6(n) {
  return String(n).padStart(6, "0");
}

function yyyymmdd(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

app.post("/sales", authRequired, roleRequired("cashier", "admin"), (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  const discount = Number(req.body.discount ?? 0);
  const cashReceived = Number(req.body.cash_received ?? 0);

  if (!items.length) return res.status(400).json({ error: "items is required" });
  if (!Number.isFinite(discount) || discount < 0) return res.status(400).json({ error: "discount must be >= 0" });
  if (!Number.isFinite(cashReceived) || cashReceived < 0) return res.status(400).json({ error: "cash_received must be >= 0" });

  // normalize + validate items
  const cleanItems = items.map((it) => ({
    product_id: Number(it.product_id),
    qty: Number(it.qty),
  }));

  for (const it of cleanItems) {
    if (!Number.isInteger(it.product_id) || it.product_id <= 0) {
      return res.status(400).json({ error: "Invalid product_id in items" });
    }
    if (!Number.isFinite(it.qty) || it.qty <= 0) {
      return res.status(400).json({ error: "Each item qty must be > 0" });
    }
    // optional: enforce integer qty for sari-sari
    if (!Number.isInteger(it.qty)) {
      return res.status(400).json({ error: "Each item qty must be an integer" });
    }
  }

  // Start transaction
  db.beginTransaction((txErr) => {
    if (txErr) {
      console.error("TX error:", txErr);
      return res.status(500).json({ error: "Failed to start transaction" });
    }

    // Step A: lock product rows FOR UPDATE (prevents race selling)
    const ids = [...new Set(cleanItems.map((x) => x.product_id))];
    const placeholders = ids.map(() => "?").join(",");

    db.query(
      `
      SELECT id, sku, name, current_price, stock, is_active
      FROM products
      WHERE id IN (${placeholders})
      FOR UPDATE
      `,
      ids,
      (err, productRows) => {
        if (err) {
          console.error("DB error:", err);
          return db.rollback(() => res.status(500).json({ error: "Database error" }));
        }

        // map products
        const byId = new Map(productRows.map(p => [p.id, p]));

        // validate all items exist + active + enough stock
        for (const it of cleanItems) {
          const p = byId.get(it.product_id);
          if (!p) {
            return db.rollback(() => res.status(404).json({ error: `Product not found: ${it.product_id}` }));
          }
          if (Number(p.is_active) !== 1) {
            return db.rollback(() => res.status(400).json({ error: `Item inactive: ${p.sku}` }));
          }
          if (Number(p.stock) < it.qty) {
            return db.rollback(() => res.status(400).json({ error: `Not enough stock for ${p.sku}` }));
          }
        }

        // Step B: compute totals + build sale_items rows
        const saleItems = cleanItems.map((it) => {
          const p = byId.get(it.product_id);
          const unitPrice = Number(p.current_price);
          const lineTotal = Number((unitPrice * it.qty).toFixed(2));

          return {
            product_id: p.id,
            sku_snapshot: p.sku,
            name_snapshot: p.name,
            qty: it.qty,
            unit_price: unitPrice,
            line_total: lineTotal,
          };
        });

        const subtotal = saleItems.reduce((sum, r) => sum + r.line_total, 0);
        const totalAmount = Number((subtotal - discount).toFixed(2));

        if (totalAmount < 0) {
          return db.rollback(() => res.status(400).json({ error: "discount is too large" }));
        }

        if (cashReceived < totalAmount) {
          return db.rollback(() => res.status(400).json({ error: "Insufficient cash" }));
        }

        const changeDue = Number((cashReceived - totalAmount).toFixed(2));

        // Step C: create sale header
        db.query(
          `
          INSERT INTO sales (receipt_no, subtotal, discount, total_amount, cash_received, change_due, status)
          VALUES (?, ?, ?, ?, ?, ?, 'PAID')
          `,
          ["TEMP", subtotal, discount, totalAmount, cashReceived, changeDue],
          (err2, saleResult) => {
            if (err2) {
              console.error("DB error:", err2);
              return db.rollback(() => res.status(500).json({ error: "Database error" }));
            }

            const saleId = saleResult.insertId;
            const receiptNo = `${yyyymmdd()}-${pad6(saleId)}`;

            // update receipt_no
            db.query(
              "UPDATE sales SET receipt_no = ? WHERE id = ?",
              [receiptNo, saleId],
              (err3) => {
                if (err3) {
                  console.error("DB error:", err3);
                  return db.rollback(() => res.status(500).json({ error: "Database error" }));
                }

                // Step D: insert sale_items (bulk)
                const values = saleItems.map(r => [
                  saleId,
                  r.product_id,
                  r.sku_snapshot,
                  r.name_snapshot,
                  r.qty,
                  r.unit_price,
                  r.line_total,
                ]);

                db.query(
                  `
                  INSERT INTO sale_items
                    (sale_id, product_id, sku_snapshot, name_snapshot, qty, unit_price, line_total)
                  VALUES ?
                  `,
                  [values],
                  (err4) => {
                    if (err4) {
                      console.error("DB error:", err4);
                      return db.rollback(() => res.status(500).json({ error: "Database error" }));
                    }

                    // Step E: deduct stock + log movements for each item
                    let i = 0;

                    function next() {
                      if (i >= saleItems.length) {
                        // commit
                        return db.commit((commitErr) => {
                          if (commitErr) {
                            console.error("Commit error:", commitErr);
                            return db.rollback(() => res.status(500).json({ error: "Commit failed" }));
                          }

                          res.status(201).json({
                            message: "Sale completed ✅",
                            saleId,
                            receipt_no: receiptNo,
                            subtotal,
                            discount,
                            total_amount: totalAmount,
                            cash_received: cashReceived,
                            change_due: changeDue,
                          });
                        });
                      }

                      const r = saleItems[i++];

                      db.query(
                        "UPDATE products SET stock = stock - ? WHERE id = ?",
                        [r.qty, r.product_id],
                        (err5) => {
                          if (err5) {
                            console.error("DB error:", err5);
                            return db.rollback(() => res.status(500).json({ error: "Database error" }));
                          }

                          db.query(
                            `
                            INSERT INTO stock_movements
                              (product_id, type, qty, unit_cost, note, ref_type, ref_id)
                            VALUES (?, 'OUT', ?, NULL, ?, 'SALE', ?)
                            `,
                            [r.product_id, r.qty, `Sale ${receiptNo}`, saleId],
                            (err6) => {
                              if (err6) {
                                console.error("DB error:", err6);
                                return db.rollback(() => res.status(500).json({ error: "Database error" }));
                              }
                              next();
                            }
                          );
                        }
                      );
                    }

                    next();
                  }
                );
              }
            );
          }
        );
      }
    );
  });
});

// GET /sales/:id (receipt details) (Cashier + Admin)
app.get("/sales/:id", authRequired, roleRequired("cashier", "admin"), (req, res) => {
  const saleId = Number(req.params.id);
  if (!Number.isInteger(saleId) || saleId <= 0) {
    return res.status(400).json({ error: "Invalid sale id" });
  }

  db.query(
    "SELECT * FROM sales WHERE id = ?",
    [saleId],
    (err, saleRows) => {
      if (err) {
        console.error("DB error:", err);
        return res.status(500).json({ error: "Database error" });
      }
      if (!saleRows.length) return res.status(404).json({ error: "Sale not found" });

      db.query(
        `
        SELECT id, product_id, sku_snapshot, name_snapshot, qty, unit_price, line_total
        FROM sale_items
        WHERE sale_id = ?
        ORDER BY id ASC
        `,
        [saleId],
        (err2, itemRows) => {
          if (err2) {
            console.error("DB error:", err2);
            return res.status(500).json({ error: "Database error" });
          }

          res.json({ sale: saleRows[0], items: itemRows });
        }
      );
    }
  );
});

// GET /sales/receipt/:receiptNo (Cashier + Admin)
app.get("/sales/receipt/:receiptNo", authRequired, roleRequired("cashier", "admin"), (req, res) => {
  const receiptNo = String(req.params.receiptNo || "").trim();
  if (!receiptNo) return res.status(400).json({ error: "receiptNo is required" });

  db.query("SELECT * FROM sales WHERE receipt_no = ?", [receiptNo], (err, saleRows) => {
    if (err) return res.status(500).json({ error: "Database error" });
    if (!saleRows.length) return res.status(404).json({ error: "Receipt not found" });

    const sale = saleRows[0];

    db.query(
      `SELECT id, product_id, sku_snapshot, name_snapshot, qty, unit_price, line_total
       FROM sale_items
       WHERE sale_id = ?
       ORDER BY id ASC`,
      [sale.id],
      (err2, itemRows) => {
        if (err2) return res.status(500).json({ error: "Database error" });
        res.json({ sale, items: itemRows });
      }
    );
  });
});

/* =========================
   REPORTS (Admin only)
========================= */
function isValidYMD(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function rangeWhere(field, start, end) {
  // inclusive start, inclusive end (we convert end to next day)
  // WHERE sold_at >= start AND sold_at < end+1day
  return {
    sql: `(${field} >= ? AND ${field} < DATE_ADD(?, INTERVAL 1 DAY))`,
    params: [start, end],
  };
}

app.get("/reports/sales-summary", authRequired, roleRequired("admin"), (req, res) => {
  const start = String(req.query.start || "").trim();
  const end = String(req.query.end || "").trim();

  if (!isValidYMD(start) || !isValidYMD(end)) {
    return res.status(400).json({ error: "start and end are required (YYYY-MM-DD)" });
  }

  const w = rangeWhere("s.sold_at", start, end);

  const sql = `
    SELECT
      COUNT(*) AS transactions,
      COALESCE(SUM(s.subtotal), 0) AS subtotal,
      COALESCE(SUM(s.discount), 0) AS discount,
      COALESCE(SUM(s.total_amount), 0) AS total_sales
    FROM sales s
    WHERE ${w.sql} AND s.status = 'PAID'
  `;

  db.query(sql, w.params, (err, rows) => {
    if (err) {
      console.error("DB error:", err);
      return res.status(500).json({ error: "Database error" });
    }

    const summary = rows[0] || { transactions: 0, subtotal: 0, discount: 0, total_sales: 0 };

    // items sold in range
    const sql2 = `
      SELECT COALESCE(SUM(si.qty), 0) AS items_sold
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE ${w.sql} AND s.status = 'PAID'
    `;

    db.query(sql2, w.params, (err2, rows2) => {
      if (err2) {
        console.error("DB error:", err2);
        return res.status(500).json({ error: "Database error" });
      }

      res.json({
        start,
        end,
        transactions: Number(summary.transactions),
        items_sold: Number(rows2[0]?.items_sold || 0),
        subtotal: Number(summary.subtotal),
        discount: Number(summary.discount),
        total_sales: Number(summary.total_sales),
      });
    });
  });
});

app.get("/reports/daily-sales", authRequired, roleRequired("admin"), (req, res) => {
  const start = String(req.query.start || "").trim();
  const end = String(req.query.end || "").trim();

  if (!isValidYMD(start) || !isValidYMD(end)) {
    return res.status(400).json({ error: "start and end are required (YYYY-MM-DD)" });
  }

  const w = rangeWhere("s.sold_at", start, end);

  const sql = `
    SELECT
      DATE(s.sold_at) AS day,
      COUNT(*) AS transactions,
      COALESCE(SUM(s.total_amount), 0) AS total_sales
    FROM sales s
    WHERE ${w.sql} AND s.status = 'PAID'
    GROUP BY DATE(s.sold_at)
    ORDER BY day ASC
  `;

  db.query(sql, w.params, (err, rows) => {
    if (err) {
      console.error("DB error:", err);
      return res.status(500).json({ error: "Database error" });
    }
    res.json({ start, end, days: rows });
  });
});

app.get("/reports/top-products", authRequired, roleRequired("admin"), (req, res) => {
  const start = String(req.query.start || "").trim();
  const end = String(req.query.end || "").trim();
  const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 50);

  if (!isValidYMD(start) || !isValidYMD(end)) {
    return res.status(400).json({ error: "start and end are required (YYYY-MM-DD)" });
  }

  const w = rangeWhere("s.sold_at", start, end);

  const sql = `
    SELECT
      si.product_id,
      si.sku_snapshot,
      si.name_snapshot,
      SUM(si.qty) AS qty_sold,
      COALESCE(SUM(si.line_total), 0) AS revenue
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    WHERE ${w.sql} AND s.status = 'PAID'
    GROUP BY si.product_id, si.sku_snapshot, si.name_snapshot
    ORDER BY qty_sold DESC
    LIMIT ?
  `;

  db.query(sql, [...w.params, limit], (err, rows) => {
    if (err) {
      console.error("DB error:", err);
      return res.status(500).json({ error: "Database error" });
    }
    res.json({ start, end, limit, rows });
  });
});

app.get("/reports/low-stock", authRequired, roleRequired("admin"), (req, res) => {
  const sql = `
    SELECT id, sku, barcode, name, stock, reorder_level, current_price
    FROM products
    WHERE is_active = 1 AND stock <= reorder_level
    ORDER BY stock ASC, name ASC
  `;

  db.query(sql, (err, rows) => {
    if (err) {
      console.error("DB error:", err);
      return res.status(500).json({ error: "Database error" });
    }
    res.json({ count: rows.length, rows });
  });
});

// 🖨️ PRINTABLE DAILY SALES REPORT (Admin only)
// Open: /reports/daily-print?date=YYYY-MM-DD
app.get("/reports/daily-print", authRequired, roleRequired("admin"), (req, res) => {
  const date = String(req.query.date || "").trim();

  if (!isValidYMD(date)) {
    return res.status(400).send("Invalid date. Use YYYY-MM-DD");
  }

  // same-day range
  const w = rangeWhere("s.sold_at", date, date);

  const summarySql = `
    SELECT
      COUNT(*) AS transactions,
      COALESCE(SUM(s.subtotal), 0) AS subtotal,
      COALESCE(SUM(s.discount), 0) AS discount,
      COALESCE(SUM(s.total_amount), 0) AS total_sales
    FROM sales s
    WHERE ${w.sql} AND s.status = 'PAID'
  `;

  db.query(summarySql, w.params, (err, sumRows) => {
    if (err) {
      console.error("DB error:", err);
      return res.status(500).send("Database error");
    }

    const summary = sumRows[0] || {
      transactions: 0,
      subtotal: 0,
      discount: 0,
      total_sales: 0,
    };

    const itemsSql = `
      SELECT COALESCE(SUM(si.qty), 0) AS items_sold
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE ${w.sql} AND s.status = 'PAID'
    `;

    db.query(itemsSql, w.params, (err2, itemRows) => {
      if (err2) {
        console.error("DB error:", err2);
        return res.status(500).send("Database error");
      }

      const itemsSold = Number(itemRows[0]?.items_sold || 0);

      const receiptsSql = `
        SELECT receipt_no, sold_at, total_amount
        FROM sales s
        WHERE ${w.sql} AND s.status = 'PAID'
        ORDER BY sold_at ASC
      `;

      db.query(receiptsSql, w.params, (err3, receipts) => {
        if (err3) {
          console.error("DB error:", err3);
          return res.status(500).send("Database error");
        }

        const esc = (s) =>
          String(s ?? "").replace(/[&<>"']/g, (c) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          }[c]));

        const fmt = (n) => `₱${Number(n || 0).toFixed(2)}`;

        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.send(`
<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Daily Sales Report — ${esc(date)}</title>
<style>
  :root{
    --muted:#666;
    --border:#ddd;
    --bg:#fff;
  }
  body{ font-family: Arial, sans-serif; background: var(--bg); color:#111; padding:24px; }
  .top{ display:flex; justify-content:space-between; align-items:flex-start; gap:16px; }
  h1{ margin:0; font-size:22px; }
  .muted{ color:var(--muted); font-size:13px; margin-top:4px; }
  .btns{ display:flex; gap:8px; }
  button{
    padding:10px 12px; border:1px solid var(--border); background:#f7f7f7;
    border-radius:10px; cursor:pointer; font-weight:600;
  }
  button:hover{ background:#efefef; }
  .card{ border:1px solid var(--border); border-radius:14px; padding:14px; margin-top:14px; }
  .grid{ display:grid; grid-template-columns: 1fr 1fr; gap:10px; }
  .row{ display:flex; justify-content:space-between; gap:10px; }
  .row b{ font-size:14px; }
  .big{ font-size:18px; font-weight:800; }
  table{ width:100%; border-collapse:collapse; margin-top:12px; }
  th,td{ border:1px solid var(--border); padding:8px 10px; text-align:left; font-size:13px; }
  th{ background:#f4f4f4; }
  td.r{ text-align:right; }
  .foot{ margin-top:14px; font-size:12px; color:var(--muted); }

  @media print{
    .btns{ display:none !important; }
    body{ padding:0; }
    .card{ border:none; padding:0; }
    th{ background:#eee !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>

<div class="top">
  <div>
    <h1>Daily Sales Report</h1>
    <div class="muted">Date: ${esc(date)}</div>
  </div>

  <div class="btns">
    <button onclick="window.print()">🖨️ Print</button>
    <button onclick="window.close()">Close</button>
  </div>
</div>

<div class="card">
  <div class="grid">
    <div class="row"><span>Transactions</span><b>${Number(summary.transactions)}</b></div>
    <div class="row"><span>Items Sold</span><b>${itemsSold}</b></div>
    <div class="row"><span>Subtotal</span><b>${fmt(summary.subtotal)}</b></div>
    <div class="row"><span>Discount</span><b>${fmt(summary.discount)}</b></div>
    <div class="row"><span>Total Sales</span><span class="big">${fmt(summary.total_sales)}</span></div>
    <div></div>
  </div>
</div>

<div class="card">
  <b>Receipts</b>
  <table>
    <thead>
      <tr>
        <th style="width:38%;">Receipt #</th>
        <th style="width:32%;">Time</th>
        <th style="width:30%;">Total</th>
      </tr>
    </thead>
    <tbody>
      ${
        receipts.length
          ? receipts.map(r => `
            <tr>
              <td>${esc(r.receipt_no)}</td>
              <td>${new Date(r.sold_at).toLocaleTimeString()}</td>
              <td class="r">${fmt(r.total_amount)}</td>
            </tr>
          `).join("")
          : `<tr><td colspan="3" class="muted">No sales for this date.</td></tr>`
      }
    </tbody>
  </table>

  <div class="foot">Generated by POS Store • ${new Date().toLocaleString()}</div>
</div>

</body>
</html>
        `);
      });
    });
  });
});

// 📄 CSV Export (Admin only)
// Download: /reports/sales.csv?start=YYYY-MM-DD&end=YYYY-MM-DD
app.get("/reports/sales.csv", authRequired, roleRequired("admin"), (req, res) => {
  const start = String(req.query.start || "").trim();
  const end = String(req.query.end || "").trim();

  if (!isValidYMD(start) || !isValidYMD(end)) {
    return res.status(400).send("Invalid date range. Use start=YYYY-MM-DD&end=YYYY-MM-DD");
  }

  const w = rangeWhere("s.sold_at", start, end);

  const sql = `
    SELECT
      s.receipt_no,
      s.sold_at,
      si.sku_snapshot,
      si.name_snapshot,
      si.qty,
      si.unit_price,
      si.line_total
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    WHERE ${w.sql} AND s.status = 'PAID'
    ORDER BY s.sold_at ASC, s.id ASC, si.id ASC
  `;

  db.query(sql, w.params, (err, rows) => {
    if (err) {
      console.error("DB error:", err);
      return res.status(500).send("Database error");
    }

    const csvEscape = (v) => {
      const s = String(v ?? "");
      // escape " by doubling it
      const escaped = s.replace(/"/g, '""');
      // wrap in quotes if contains comma/newline/quote
      return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
    };

    let csv = [
      "Receipt No",
      "Sold At",
      "SKU",
      "Product Name",
      "Qty",
      "Unit Price",
      "Line Total",
    ].join(",") + "\n";

    for (const r of rows) {
      csv += [
        csvEscape(r.receipt_no),
        csvEscape(r.sold_at),
        csvEscape(r.sku_snapshot),
        csvEscape(r.name_snapshot),
        r.qty,
        Number(r.unit_price).toFixed(2),
        Number(r.line_total).toFixed(2),
      ].join(",") + "\n";
    }

    const filename = `sales_${start}_to_${end}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  });
});


/* =========================
   START SERVER
========================= */
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on http://0.0.0.0:${PORT}`);
});

