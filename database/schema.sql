CREATE TABLE ingredients (
    id SERIAL PRIMARY KEY,
    nom VARCHAR(100) NOT NULL,
    unite VARCHAR(20) NOT NULL, -- ex: kg, L, unité
    stock_actuel DECIMAL(10,3) NOT NULL DEFAULT 0,
    seuil_alerte DECIMAL(10,3) DEFAULT 0
);

CREATE TABLE plats (
    id SERIAL PRIMARY KEY,
    nom VARCHAR(100) NOT NULL,
    prix DECIMAL(10,2) NOT NULL
);

CREATE TABLE recette (
    id SERIAL PRIMARY KEY,
    plat_id INTEGER NOT NULL REFERENCES plats(id) ON DELETE CASCADE,
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
    quantite_necessaire DECIMAL(10,3) NOT NULL
);

CREATE TABLE ventes (
    id SERIAL PRIMARY KEY,
    plat_id INTEGER NOT NULL REFERENCES plats(id),
    quantite INTEGER NOT NULL,
    date_vente TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE achats (
    id SERIAL PRIMARY KEY,
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
    quantite DECIMAL(10,3) NOT NULL,
    prix_unitaire DECIMAL(10,2),
    date_achat TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE mouvements_stock (
    id SERIAL PRIMARY KEY,
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
    type_mouvement VARCHAR(20) NOT NULL, -- 'vente', 'achat', 'ajustement'
    quantite DECIMAL(10,3) NOT NULL,     -- négatif pour une sortie
    reference_id INTEGER,                -- id de la vente ou de l'achat lié
    motif TEXT,                          -- raison d'un ajustement manuel
    date_mouvement TIMESTAMP NOT NULL DEFAULT NOW()
);