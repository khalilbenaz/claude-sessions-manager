-- Une ligne par session synchronisée. Les conversations (tables csm_transcripts / csm_chunks) arrivent
-- chiffrées par l'app : le serveur ne peut pas les lire.
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

-- Espaces créés par POST /spaces. Seule l'empreinte du code est gardée ; ipHash sert à limiter les créations.
CREATE TABLE IF NOT EXISTS csm_spaces (
  space     TEXT PRIMARY KEY,
  createdAt INTEGER NOT NULL,
  ipHash    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS csm_spaces_created ON csm_spaces(createdAt);

-- Conversation en vigueur de chaque session : version (HMAC du contenu, calculé par l'app) et nombre de morceaux.
CREATE TABLE IF NOT EXISTS csm_transcripts (
  space     TEXT NOT NULL,
  uid       TEXT NOT NULL,      -- syncId de la session
  cid       TEXT NOT NULL,      -- identifiant de la conversation Claude Code
  ver       TEXT NOT NULL,
  chunks    INTEGER NOT NULL,
  size      INTEGER NOT NULL,   -- octets chiffrés
  updatedAt INTEGER NOT NULL,   -- date de modification du transcript sur la machine qui l'a envoyé
  origin    TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (space, uid)
);

-- Morceaux chiffrés (1 Mo au plus, en base64).
CREATE TABLE IF NOT EXISTS csm_chunks (
  space TEXT NOT NULL,
  uid   TEXT NOT NULL,
  ver   TEXT NOT NULL,
  n     INTEGER NOT NULL,
  data  TEXT NOT NULL,
  PRIMARY KEY (space, uid, ver, n)
);
