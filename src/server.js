const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const morgan = require('morgan');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data', 'forms');
const AUTH_TOKEN = process.env.AUTH_TOKEN;

// Morgan logging middleware
app.use(morgan('dev', { stream: process.stdout }));

// Middleware to check the Auth-Token
app.use((req, res, next) => {
  const token = req.headers['authorization'];
  if (token === `Bearer ${AUTH_TOKEN}`) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
});

app.get('/v1/forms/:type/:year/:form', async (req, res) => {
  const { type, year, form } = req.params;
  const filePath = path.join(DATA_DIR, type, year, `${form}.json`);

  try {
    const data = await fs.readFile(filePath, 'utf-8');
    res.json(JSON.parse(data));
  } catch (err) {
    if (err.code === 'ENOENT') {
      res.status(404).json({ error: 'Form not found.' });
    } else {
      console.error(err);
      res.status(500).json({ error: 'Internal server error.' });
    }
  }
});

app.listen(PORT, () => {
  console.log(`API server running at http://localhost:${PORT}`);
});