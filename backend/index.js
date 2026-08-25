const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// --- routes existantes ---
app.get('/', async (req, res) => {
  res.send('Ça marche !');
});

app.get('/api/ingredients', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM ingredients ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ingredients', async (req, res) => {
  const { nom, unite, stock_actuel, seuil_alerte } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO ingredients (nom, unite, stock_actuel, seuil_alerte) VALUES ($1, $2, $3, $4) RETURNING *',
      [nom, unite, stock_actuel || 0, seuil_alerte || 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/plats', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM plats ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- NOUVELLE ROUTE : ventes avec décrément de stock ---
app.post('/api/ventes', async (req, res) => {
  const { plat_id, quantite } = req.body;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const vente = await client.query(
      'INSERT INTO ventes (plat_id, quantite) VALUES ($1, $2) RETURNING *',
      [plat_id, quantite]
    );

    const recette = await client.query(
      'SELECT ingredient_id, quantite_necessaire FROM recette WHERE plat_id = $1',
      [plat_id]
    );

    for (const ligne of recette.rows) {
      const quantiteADeduire = ligne.quantite_necessaire * quantite;

      await client.query(
        'UPDATE ingredients SET stock_actuel = stock_actuel - $1 WHERE id = $2',
        [quantiteADeduire, ligne.ingredient_id]
      );

      await client.query(
        `INSERT INTO mouvements_stock (ingredient_id, type_mouvement, quantite, reference_id)
         VALUES ($1, 'vente', $2, $3)`,
        [ligne.ingredient_id, -quantiteADeduire, vente.rows[0].id]
      );
    }

    await client.query('COMMIT');
    res.status(201).json(vente.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// --- doit rester en dernier ---
app.listen(3000, () => console.log('Serveur sur le port 3000'));