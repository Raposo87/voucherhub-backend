-- Basic vouchers table
CREATE TABLE IF NOT EXISTS vouchers (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  partner_slug VARCHAR(100) NOT NULL,
  code VARCHAR(64) NOT NULL UNIQUE,
  
  -- Campos de detalhe da compra
  product_name VARCHAR(255),               
  value DECIMAL(10, 2),                   -- Valor do voucher (ex: R$ 450.00)
  valid_until DATE,                       -- Data limite para uso
  
  stripe_session_id VARCHAR(255) UNIQUE,
  
  -- COLUNAS PARA VALIDAÇÃO SEMI-AUTOMÁTICA
  status VARCHAR(20) DEFAULT 'active',    -- Status: 'active' | 'used' | 'expired'
  validated_at TIMESTAMP,                 -- Data/hora em que foi resgatado
  partner_pin VARCHAR(10),                -- PIN secreto do parceiro (PARA SEGURANÇA)
  
  created_at TIMESTAMP DEFAULT NOW()
);
```eof

#### 2. Implantar o Backend

Com o `schema.sql` corrigido e o banco de dados migrado, você pode fazer o **commit** e **push** do seu código Node.js (com as rotas de `vouchers.js` e `payments.js` que usam as novas colunas) para o Railway.

Assim que o deploy terminar, o seu projeto estará 100% funcional, desde a compra (Stripe) até a validação (Link/PIN).