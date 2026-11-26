-- PASO 1. Ejecutar por separado y esperar Success antes del paso 2.
-- PostgreSQL exige confirmar el nuevo valor antes de utilizarlo.
alter type public.assignment_status add value if not exists 'cerrada';
