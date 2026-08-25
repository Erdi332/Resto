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

function validateIngredientFields({ nom, unite, stock_actuel, seuil_alerte }, { requireStock }) {
  if (typeof nom !== 'string' || nom.trim() === '') {
    return { error: 'nom is required.' };
  }
  if (typeof unite !== 'string' || unite.trim() === '') {
    return { error: 'unite is required.' };
  }

  const stock = stock_actuel === undefined && !requireStock ? 0 : Number(stock_actuel);
  const seuil = seuil_alerte === undefined && !requireStock ? 0 : Number(seuil_alerte);

  if (Number.isNaN(stock) || stock < 0) {
    return { error: 'stock_actuel must be a number >= 0.' };
  }
  if (Number.isNaN(seuil) || seuil < 0) {
    return { error: 'seuil_alerte must be a number >= 0.' };
  }

  return { nom: nom.trim(), unite: unite.trim(), stock, seuil };
}

app.post('/api/ingredients', async (req, res) => {
  const parsed = validateIngredientFields(req.body, { requireStock: false });
  if (parsed.error) {
    return res.status(400).json({ error: parsed.error });
  }

  try {
    const result = await pool.query(
      'INSERT INTO ingredients (nom, unite, stock_actuel, seuil_alerte) VALUES ($1, $2, $3, $4) RETURNING *',
      [parsed.nom, parsed.unite, parsed.stock, parsed.seuil]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/ingredients/:id', async (req, res) => {
  const parsed = validateIngredientFields(req.body, { requireStock: true });
  if (parsed.error) {
    return res.status(400).json({ error: parsed.error });
  }

  try {
    const result = await pool.query(
      'UPDATE ingredients SET nom = $1, unite = $2, stock_actuel = $3, seuil_alerte = $4 WHERE id = $5 RETURNING *',
      [parsed.nom, parsed.unite, parsed.stock, parsed.seuil, req.params.id]
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

// --- ajustement manuel de stock (casse, perte, comptage physique...) ---
app.post('/api/ingredients/:id/ajustement', async (req, res) => {
  const { quantite, motif } = req.body;
  const nouveauStock = Number(quantite);

  if (Number.isNaN(nouveauStock) || nouveauStock < 0) {
    return res.status(400).json({ error: 'quantite must be a number >= 0.' });
  }
  if (typeof motif !== 'string' || motif.trim() === '') {
    return res.status(400).json({ error: 'motif is required.' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const current = await client.query(
      'SELECT stock_actuel FROM ingredients WHERE id = $1 FOR UPDATE',
      [req.params.id]
    );

    if (current.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Ingredient not found' });
    }

    const delta = nouveauStock - parseFloat(current.rows[0].stock_actuel);

    const updated = await client.query(
      'UPDATE ingredients SET stock_actuel = $1 WHERE id = $2 RETURNING *',
      [nouveauStock, req.params.id]
    );

    await client.query(
      `INSERT INTO mouvements_stock (ingredient_id, type_mouvement, quantite, motif)
       VALUES ($1, 'ajustement', $2, $3)`,
      [req.params.id, delta, motif.trim()]
    );

    await client.query('COMMIT');
    res.json(updated.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
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

function validatePlatFields({ nom, prix }) {
  if (typeof nom !== 'string' || nom.trim() === '') {
    return { error: 'nom is required.' };
  }
  const prixNum = Number(prix);
  if (Number.isNaN(prixNum) || prixNum < 0) {
    return { error: 'prix must be a number >= 0.' };
  }
  return { nom: nom.trim(), prix: prixNum };
}

function validateRecetteLines(ingredients) {
  if (ingredients === undefined) return { lines: [] };
  if (!Array.isArray(ingredients)) {
    return { error: 'ingredients must be an array.' };
  }
  for (const ligne of ingredients) {
    if (!Number.isInteger(ligne.ingredient_id)) {
      return { error: 'Each recipe line needs a valid ingredient_id.' };
    }
    if (typeof ligne.quantite_necessaire !== 'number' || ligne.quantite_necessaire <= 0) {
      return { error: 'Each recipe line needs quantite_necessaire > 0.' };
    }
  }
  return { lines: ingredients };
}

app.post('/api/plats', async (req, res) => {
  const parsedPlat = validatePlatFields(req.body);
  if (parsedPlat.error) {
    return res.status(400).json({ error: parsedPlat.error });
  }

  const parsedRecette = validateRecetteLines(req.body.ingredients);
  if (parsedRecette.error) {
    return res.status(400).json({ error: parsedRecette.error });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const plat = await client.query(
      'INSERT INTO plats (nom, prix) VALUES ($1, $2) RETURNING *',
      [parsedPlat.nom, parsedPlat.prix]
    );

    for (const ligne of parsedRecette.lines) {
      await client.query(
        'INSERT INTO recette (plat_id, ingredient_id, quantite_necessaire) VALUES ($1, $2, $3)',
        [plat.rows[0].id, ligne.ingredient_id, ligne.quantite_necessaire]
      );
    }

    await client.query('COMMIT');
    res.status(201).json(plat.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23503') {
      return res.status(400).json({ error: 'One of the recipe ingredients does not exist.' });
    }
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.put('/api/plats/:id', async (req, res) => {
  const parsed = validatePlatFields(req.body);
  if (parsed.error) {
    return res.status(400).json({ error: parsed.error });
  }

  try {
    const result = await pool.query(
      'UPDATE plats SET nom = $1, prix = $2 WHERE id = $3 RETURNING *',
      [parsed.nom, parsed.prix, req.params.id]
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

  if (!Number.isInteger(ingredient_id)) {
    return res.status(400).json({ error: 'ingredient_id is required.' });
  }
  if (typeof quantite_necessaire !== 'number' || quantite_necessaire <= 0) {
    return res.status(400).json({ error: 'quantite_necessaire must be a number > 0.' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO recette (plat_id, ingredient_id, quantite_necessaire) VALUES ($1, $2, $3) RETURNING *',
      [req.params.id, ingredient_id, quantite_necessaire]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23503') {
      return res.status(400).json({ error: 'Dish or ingredient not found.' });
    }
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/recette/:id', async (req, res) => {
  const { quantite_necessaire } = req.body;

  if (typeof quantite_necessaire !== 'number' || quantite_necessaire <= 0) {
    return res.status(400).json({ error: 'quantite_necessaire must be a number > 0.' });
  }

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

// --- achats : réapprovisionnement des ingrédients ---
app.get('/api/achats', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT achats.id, achats.ingredient_id, achats.quantite, achats.prix_unitaire, achats.date_achat,
              ingredients.nom AS ingredient_nom, ingredients.unite AS ingredient_unite
       FROM achats
       JOIN ingredients ON ingredients.id = achats.ingredient_id
       ORDER BY achats.date_achat DESC
       LIMIT 50`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/achats', async (req, res) => {
  const { ingredient_id, quantite, prix_unitaire } = req.body;

  if (!Number.isInteger(ingredient_id)) {
    return res.status(400).json({ error: 'ingredient_id is required.' });
  }
  const qte = Number(quantite);
  if (Number.isNaN(qte) || qte <= 0) {
    return res.status(400).json({ error: 'quantite must be a number > 0.' });
  }

  let prixUnitaire = null;
  if (prix_unitaire !== undefined && prix_unitaire !== null && prix_unitaire !== '') {
    prixUnitaire = Number(prix_unitaire);
    if (Number.isNaN(prixUnitaire) || prixUnitaire < 0) {
      return res.status(400).json({ error: 'prix_unitaire must be a number >= 0.' });
    }
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const achat = await client.query(
      'INSERT INTO achats (ingredient_id, quantite, prix_unitaire) VALUES ($1, $2, $3) RETURNING *',
      [ingredient_id, qte, prixUnitaire]
    );

    const updated = await client.query(
      'UPDATE ingredients SET stock_actuel = stock_actuel + $1 WHERE id = $2 RETURNING id',
      [qte, ingredient_id]
    );

    if (updated.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Ingredient not found.' });
    }

    await client.query(
      `INSERT INTO mouvements_stock (ingredient_id, type_mouvement, quantite, reference_id)
       VALUES ($1, 'achat', $2, $3)`,
      [ingredient_id, qte, achat.rows[0].id]
    );

    await client.query('COMMIT');
    res.status(201).json(achat.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23503') {
      return res.status(400).json({ error: 'Ingredient not found.' });
    }
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// --- historique des mouvements de stock (ventes, achats, ajustements) ---
app.get('/api/mouvements-stock', async (req, res) => {
  const { ingredient_id } = req.query;

  try {
    const params = [];
    let whereClause = '';

    if (ingredient_id) {
      params.push(ingredient_id);
      whereClause = 'WHERE mouvements_stock.ingredient_id = $1';
    }

    params.push(50);

    const result = await pool.query(
      `SELECT mouvements_stock.id, mouvements_stock.ingredient_id, mouvements_stock.type_mouvement,
              mouvements_stock.quantite, mouvements_stock.reference_id, mouvements_stock.motif,
              mouvements_stock.date_mouvement,
              ingredients.nom AS ingredient_nom, ingredients.unite AS ingredient_unite
       FROM mouvements_stock
       JOIN ingredients ON ingredients.id = mouvements_stock.ingredient_id
       ${whereClause}
       ORDER BY mouvements_stock.date_mouvement DESC
       LIMIT $${params.length}`,
      params
    );
    res.json(result.rows);
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

  if (!Number.isInteger(plat_id)) {
    return res.status(400).json({ error: 'plat_id is required.' });
  }
  if (typeof quantite !== 'number' || quantite <= 0) {
    return res.status(400).json({ error: 'quantite must be a number > 0.' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const plat = await client.query('SELECT id FROM plats WHERE id = $1', [plat_id]);
    if (plat.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Dish not found.' });
    }

    // FOR UPDATE : verrouille les lignes d'ingrédients pour éviter une vente concurrente
    // qui ferait passer le stock sous zéro entre la vérification et la mise à jour.
    const recette = await client.query(
      `SELECT recette.ingredient_id, recette.quantite_necessaire,
              ingredients.nom AS ingredient_nom, ingredients.stock_actuel
       FROM recette
       JOIN ingredients ON ingredients.id = recette.ingredient_id
       WHERE recette.plat_id = $1
       FOR UPDATE OF ingredients`,
      [plat_id]
    );

    if (recette.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This dish has no recipe defined and cannot be sold.' });
    }

    for (const ligne of recette.rows) {
      const quantiteADeduire = ligne.quantite_necessaire * quantite;
      const stockDisponible = parseFloat(ligne.stock_actuel);

      if (stockDisponible < quantiteADeduire) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Insufficient stock for "${ligne.ingredient_nom}": need ${quantiteADeduire}, have ${stockDisponible}.`,
        });
      }
    }

    const vente = await client.query(
      'INSERT INTO ventes (plat_id, quantite) VALUES ($1, $2) RETURNING *',
      [plat_id, quantite]
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