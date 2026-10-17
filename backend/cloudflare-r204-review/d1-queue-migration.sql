-- REVIEW-ONLY, NOT APPLIED. Additive migration for the LOCAL-candidate schema (research_jobs, internal_nonces).
-- Verify the deployed D1 schema in Cloudflare before applying anything.
ALTER TABLE research_jobs ADD COLUMN claim_token TEXT;
ALTER TABLE research_jobs ADD COLUMN claim_expires_at INTEGER;
ALTER TABLE research_jobs ADD COLUMN session_hash TEXT; -- SHA-256 of the browser X-TENS-Public-Session token, never the token
ALTER TABLE research_jobs ADD COLUMN claim_count INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_research_jobs_claim ON research_jobs(state,created_at,id);
CREATE INDEX IF NOT EXISTS idx_research_jobs_session ON research_jobs(session_hash,state);
