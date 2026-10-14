'use strict';
// Usage : node scripts/create-admin.js email@exemple.tg "mot de passe" "Nom"
const auth = require('../lib/auth');
const [email, password, nom] = process.argv.slice(2);
if (!email || !password) { console.error('Usage : node scripts/create-admin.js <email> <mot de passe> [nom]'); process.exit(1); }
if (password.length < 10) { console.error('Mot de passe trop court (10 caractères minimum).'); process.exit(1); }
auth.createAdmin(email, password, nom);
console.log('Compte enregistré pour', email);
