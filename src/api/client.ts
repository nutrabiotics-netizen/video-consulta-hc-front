// Backend en Railway. En dev (npm run dev) BASE = '' y Vite hace proxy a localhost.
const RAILWAY_BACKEND = 'https://video-consulta-hc-back-production.up.railway.app';
const BASE =
  (import.meta as any).env?.VITE_API_URL ||
  ((import.meta as any).env?.PROD ? RAILWAY_BACKEND : '');

export async function createMeeting(): Promise<{
  meetingId: string;
  meeting: ChimeMeetingInfo;
  externalMeetingId: string;
}> {
  const res = await fetch(`${BASE}/api/chime/meeting`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function createAttendee(
  meetingId: string,
  externalUserId: string
): Promise<ChimeAttendeeInfo> {
  const res = await fetch(`${BASE}/api/chime/attendee`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ meetingId, externalUserId }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/** Obtiene historia previa del paciente. Si la API no está disponible, devuelve estructura vacía (el contenido se irá llenando con la IA). */
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
