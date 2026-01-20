// scripts/delete-stripe-account.js
import 'dotenv/config';
import Stripe from 'stripe';

// Inicializa o Stripe usando a chave do seu arquivo .env
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function deleteAccount(accountId) {
  if (!accountId) {
    console.error("Erro: Você precisa fornecer o ID da conta (ex: acct_...)");
    return;
  }

  try {
    console.log(`Tentando deletar a conta: ${accountId}...`);
    
    const deleted = await stripe.accounts.del(accountId);
    
    console.log("Sucesso! Conta deletada:");
    console.log(deleted);
  } catch (error) {
    console.error("Erro ao deletar conta Stripe:");
    console.error(error.message);
  }
}

// Captura o ID da conta enviado via linha de comando
const accountIdFromArgs = process.argv[2];
deleteAccount(accountIdFromArgs);

// Como deletar a conta:
// node scripts/delete-stripe-account.js acct_1SZI1ULEy1X3DVbg (acct_1SZI1ULEy1X3DVbg é o ID da conta que você deseja deletar)