// Alta del primer miembro del comité (nadie puede invitarlo por la API porque todavía no hay comité).
// Uso: npm run invitar -- <email> <nombre> <apellido> [manzana]
// En Hostinger, por SSH: node dist/scripts/invitar.js <email> <nombre> <apellido> [manzana]
import { eq } from 'drizzle-orm';
import { enviarEnlaceClave } from '../src/auth.ts';
import { db, pool } from '../src/db/index.ts';
import { manzanas, vecinos } from '../src/db/schema.ts';
import * as validar from '../src/validar.ts';

const [emailArg, nombreArg, apellidoArg, manzanaArg = 'Comité'] = process.argv.slice(2);
try {
    const email = validar.email(emailArg);
    const nombre = validar.texto(nombreArg, 'nombre', 40);
    const apellido = validar.texto(apellidoArg, 'apellido', 40);

    let [m] = await db.select().from(manzanas).where(eq(manzanas.nombre, manzanaArg));
    if (!m) {
        const [r] = await db.insert(manzanas).values({ nombre: manzanaArg }).$returningId();
        m = { id: r!.id, nombre: manzanaArg };
    }
    let [v] = await db.select({ id: vecinos.id }).from(vecinos).where(eq(vecinos.email, email));
    if (v) {
        await db.update(vecinos).set({ rol: 'comite', activo: true }).where(eq(vecinos.id, v.id));
    } else {
        [v] = await db.insert(vecinos).values({ nombre, apellido, email, manzanaId: m.id, rol: 'comite' }).$returningId();
    }
    await enviarEnlaceClave({ id: v!.id, nombre, email }, 'invitacion');
    console.log(`[invitar] ${email} es del comité; se le envió la invitación.`);
} catch (e) {
    console.error('[invitar]', (e as Error).message);
    process.exitCode = 1;
} finally {
    await pool.end();
}
