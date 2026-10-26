/* Crea (o actualiza la contraseña de) un usuario del panel.
   Uso: npm run create-admin -- correo@centro.es "Nombre" [admin|staff]
   La contraseña se pide por teclado o se lee de ADMIN_PASSWORD. */
import { createInterface } from 'node:readline/promises';
import { pool } from '../db.ts';
import { createUser } from '../modules/auth.ts';

const [email, name = 'Administrador', role = 'admin'] = process.argv.slice(2);
if (!email || !email.includes('@')) {
  console.error('Uso: npm run create-admin -- correo@centro.es "Nombre" [admin|staff]');
  process.exit(1);
}
let password = process.env.ADMIN_PASSWORD || '';
if (!password) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  password = await rl.question('Contraseña (mínimo 12 caracteres): ');
  rl.close();
}
try {
  const u = await createUser(email, name, password, role === 'staff' ? 'staff' : 'admin');
  console.log(`Usuario listo: ${u.email}`);
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
