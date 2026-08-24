const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.SGP_DATABASE_URL,
});

module.exports = pool;
