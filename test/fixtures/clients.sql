-- Create clients table for multi-tenant client profiles
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  business_name TEXT NOT NULL,
  niche TEXT NOT NULL,
  icp TEXT NOT NULL,
  tone TEXT NOT NULL,
  platforms TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  goals TEXT NOT NULL,
  competitors TEXT,
  onboarded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create index on slug for fast lookups
CREATE INDEX idx_clients_slug ON clients(slug);

-- Create index on active for querying active clients
CREATE INDEX idx_clients_active ON clients(active);

-- Create index on onboarded_at for time-based queries
CREATE INDEX idx_clients_onboarded_at ON clients(onboarded_at);
