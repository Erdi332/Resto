const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// --- routes existantes ---
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

app.post('/api/plats', async (req, res) => {
  const { nom, prix, ingredients } = req.body;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const plat = await client.query(
      'INSERT INTO plats (nom, prix) VALUES ($1, $2) RETURNING *',
      [nom, prix]
    );

    if (Array.isArray(ingredients)) {
      for (const ligne of ingredients) {
        await client.query(
          'INSERT INTO recette (plat_id, ingredient_id, quantite_necessaire) VALUES ($1, $2, $3)',
          [plat.rows[0].id, ligne.ingredient_id, ligne.quantite_necessaire]
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json(plat.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// --- recette : ingrédients nécessaires pour un plat ---
app.get('/api/plats/:id/recette', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT recette.id, recette.plat_id, recette.ingredient_id, recette.quantite_necessaire,
              ingredients.nom AS ingredient_nom, ingredients.unite AS ingredient_unite
       FROM recette
       JOIN ingredients ON ingredients.id = recette.ingredient_id
       WHERE recette.plat_id = $1
       ORDER BY recette.id`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/plats/:id/recette', async (req, res) => {
  const { ingredient_id, quantite_necessaire } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO recette (plat_id, ingredient_id, quantite_necessaire) VALUES ($1, $2, $3) RETURNING *',
      [req.params.id, ingredient_id, quantite_necessaire]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/recette/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM recette WHERE id = $1', [req.params.id]);
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/ventes', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ventes.id, ventes.plat_id, ventes.quantite, ventes.date_vente, plats.nom AS plat_nom
       FROM ventes
       JOIN plats ON plats.id = ventes.plat_id
       ORDER BY ventes.date_vente DESC
       LIMIT 50`
    );
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