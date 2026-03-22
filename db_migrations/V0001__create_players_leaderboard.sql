CREATE TABLE IF NOT EXISTS t_p58229874_factory_tycoon_game.players (
  player_id VARCHAR(20) PRIMARY KEY,
  balance BIGINT NOT NULL DEFAULT 0,
  total_earned BIGINT NOT NULL DEFAULT 0,
  buildings_count INT NOT NULL DEFAULT 0,
  dispensers_count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);