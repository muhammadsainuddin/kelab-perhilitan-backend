import mysql from 'mysql2';
import dotenv from 'dotenv';

dotenv.config();

// Create a connection pool to handle multiple queries efficiently
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    supportBigNumbers: true,
    bigNumberStrings: false,
});

// Convert callbacks to promises for easier async/await usage
const promisePool = pool.promise();

export default promisePool;