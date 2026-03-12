const crypto = require("crypto");
const pool = require("../db");

async function generateUniqueSupportRef() {
  while (true) {
    const random = crypto.randomBytes(4).toString("hex").toUpperCase();
    const ref = `MNU-${random}`;

    const existing = await pool.query(
      "SELECT id FROM users WHERE support_ref = $1 LIMIT 1",
      [ref]
    );

    if (existing.rows.length === 0) {
      return ref;
    }
  }
}

module.exports = generateUniqueSupportRef;