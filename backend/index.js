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

app.put('/api/ingredients/:id', async (req, res) => {
  const { nom, unite, stock_actuel, seuil_alerte } = req.body;
  try {
    const result = await pool.query(
      'UPDATE ingredients SET nom = $1, unite = $2, stock_actuel = $3, seuil_alerte = $4 WHERE id = $5 RETURNING *',
      [nom, unite, stock_actuel, seuil_alerte, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Ingredient not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/ingredients/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM ingredients WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Ingredient not found' });
    }
    res.status(204).send();
  } catch (err) {
    if (err.code === '23503') {
      return res.status(409).json({ error: 'This ingredient is used in a recipe, purchase or stock movement and cannot be deleted.' });
    }
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

app.put('/api/plats/:id', async (req, res) => {
  const { nom, prix } = req.body;
  try {
    const result = await pool.query(
      'UPDATE plats SET nom = $1, prix = $2 WHERE id = $3 RETURNING *',
      [nom, prix, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Dish not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/plats/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM plats WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Dish not found' });
    }
    res.status(204).send();
  } catch (err) {
    if (err.code === '23503') {
      return res.status(409).json({ error: 'This dish has recorded sales and cannot be deleted.' });
    }
    console.error(err);
    res.status(500).json({ error: err.message });
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

app.put('/api/recette/:id', async (req, res) => {
  const { quantite_necessaire } = req.body;
  try {
    const result = await pool.query(
      'UPDATE recette SET quantite_necessaire = $1 WHERE id = $2 RETURNING *',
      [quantite_necessaire, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Recipe line not found' });
    }
    res.json(result.rows[0]);
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

// --- annulation d'une vente : restaure le stock consommé ---
app.delete('/api/ventes/:id', async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const vente = await client.query('SELECT * FROM ventes WHERE id = $1', [req.params.id]);
    if (vente.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Sale not found' });
    }

    const { plat_id, quantite } = vente.rows[0];

    const recette = await client.query(
      'SELECT ingredient_id, quantite_necessaire FROM recette WHERE plat_id = $1',
      [plat_id]
    );

    for (const ligne of recette.rows) {
      const quantiteARestaurer = ligne.quantite_necessaire * quantite;

      await client.query(
        'UPDATE ingredients SET stock_actuel = stock_actuel + $1 WHERE id = $2',
        [quantiteARestaurer, ligne.ingredient_id]
      );

      await client.query(
        `INSERT INTO mouvements_stock (ingredient_id, type_mouvement, quantite, reference_id)
         VALUES ($1, 'annulation', $2, $3)`,
        [ligne.ingredient_id, quantiteARestaurer, vente.rows[0].id]
      );
    }

    await client.query('DELETE FROM ventes WHERE id = $1', [req.params.id]);

    await client.query('COMMIT');
    res.status(204).send();
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