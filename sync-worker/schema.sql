-- Une ligne par session synchronisée. Aucune conversation n'est stockée ici.
-- space = empreinte SHA-256 du code de synchro : chaque code est un espace isolé.
CREATE TABLE IF NOT EXISTS csm_sessions (
  space     TEXT NOT NULL,
  uid       TEXT NOT NULL,      -- syncId, identique sur toutes les machines
  data      TEXT NOT NULL,      -- JSON : nom, dossier portable, modèle, groupe, couleur…
  updatedAt INTEGER NOT NULL,   -- horloge de la machine qui a modifié (last-write-wins)
  deleted   INTEGER NOT NULL DEFAULT 0,
  origin    TEXT NOT NULL DEFAULT '',
  rev       INTEGER NOT NULL,   -- compteur du serveur : curseur de pull indépendant des horloges
  PRIMARY KEY (space, uid)
);
CREATE INDEX IF NOT EXISTS csm_sessions_rev ON csm_sessions(space, rev);
