import { env } from 'cloudflare:workers';
import { handleRatings } from '../../../server/ratings';
import locationIds from '../../../location-ids.json';

const allowedIds = new Set(locationIds);
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return handleRatings(request, env.DB, allowedIds); }
export async function POST(request: Request) { return handleRatings(request, env.DB, allowedIds); }
export async function DELETE(request: Request) { return handleRatings(request, env.DB, allowedIds); }
