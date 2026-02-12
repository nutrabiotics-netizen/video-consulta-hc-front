/**
 * Tipos compartidos frontend - Historia clínica.
 * Orden lógico: contexto → motivo → subjetivo (sistemas, antecedentes) → objetivo (examen, paraclínicos) → alertas → valoración (diagnósticos, plan) → recomendaciones.
 */

export const HISTORIA_SECCIONES = [
  'informacionGeneral',      // 1. Contexto general
  'motivoAtencion',          // 2. Motivo de consulta
  'revisionSistemas',        // 3. Revisión por sistemas (subjetivo)
  'antecedentes',            // 4. Antecedentes (subjetivo)
  'examenFisico',            // 5. Examen físico (objetivo)
  'resultadosParaclinicos',  // 6. Paraclínicos (objetivo)
  'alertasAlergias',         // 7. Alertas y alergias (seguridad)
  'diagnosticos',            // 8. Diagnósticos (valoración)
  'analisisPlan',            // 9. Análisis y plan (valoración)
  'recomendaciones',         // 10. Recomendaciones (plan al paciente)
] as const;

export type SeccionHistoria = (typeof HISTORIA_SECCIONES)[number];

export interface PropuestaSeccion {
  seccion: SeccionHistoria;
  contenido: string;
  estado: 'propuesta' | 'aceptada' | 'rechazada' | 'editada';
  contenidoEditado?: string;
}

export interface SeccionState {
  contenido: string;
  estado: 'vacia' | 'propuesta' | 'aceptada' | 'rechazada' | 'editada';
  propuestaPendiente?: string;
}

export const SECCION_LABELS: Record<SeccionHistoria, string> = {
  informacionGeneral: 'Información General',
  motivoAtencion: 'Motivo de Atención',
  revisionSistemas: 'Revisión por Sistemas',
  antecedentes: 'Antecedentes',
  examenFisico: 'Examen Físico',
  resultadosParaclinicos: 'Resultados Paraclínicos',
  alertasAlergias: 'Alertas y Alergias',
  analisisPlan: 'Análisis y Plan',
  diagnosticos: 'Diagnósticos',
  recomendaciones: 'Recomendaciones',
};

export interface TranscriptionSegment {
  isPartial: boolean;
  text: string;
  participant?: string;
  timestamp: number;
}

export interface ChimeMeetingInfo {
  meetingId: string;
  mediaPlacement: {
    audioHostUrl: string;
    audioFallbackUrl: string;
    signalingUrl: string;
    turnControlUrl: string;
  };
  mediaRegion: string;
}

export interface ChimeAttendeeInfo {
  attendeeId: string;
  joinToken: string;
  externalUserId?: string;
}
