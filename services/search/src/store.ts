import neo4j from 'neo4j-driver';
import { loadNetworkFromFiles, type Carrier, type NetworkData, type ScheduledService, type TransitNode } from '@pai/shared';

/**
 * Loads the African routes graph. Neo4j (free Community Edition) is the store of
 * record when NEO4J_URI is set; otherwise the seed files are used directly.
 * Route search itself runs over an in-memory index for sub-100ms latency.
 */
export async function loadNetwork(log: (msg: string) => void): Promise<{ data: NetworkData; source: 'neo4j' | 'files' }> {
  const uri = process.env.NEO4J_URI;
  if (!uri) return { data: loadNetworkFromFiles(), source: 'files' };
  const driver = neo4j.driver(uri, neo4j.auth.basic(process.env.NEO4J_USER ?? 'neo4j', process.env.NEO4J_PASSWORD ?? 'localpassword'));
  try {
    const session = driver.session();
    try {
      const nodes = (await session.run('MATCH (n:TransitNode) RETURN n')).records.map((r) => {
        const p = r.get('n').properties;
        return { ...p, utcOffset: Number(p.utcOffset), weatherRiskMonths: (p.weatherRiskMonths ?? []).map(Number) } as TransitNode;
      });
      const carriers = (await session.run('MATCH (c:Carrier) RETURN c')).records.map((r) => r.get('c').properties as Carrier);
      const services = (
        await session.run('MATCH (a:TransitNode)-[s:SERVICE]->(b:TransitNode) RETURN a.code AS from, b.code AS to, s')
      ).records.map((r) => {
        const s = r.get('s').properties;
        return {
          carrier: s.carrier_id,
          number: s.flight_number,
          from: r.get('from'),
          to: r.get('to'),
          dep: s.dep_local,
          durationMin: Number(s.duration_minutes),
          days: (s.days as unknown[]).map(Number),
          fareUsd: Number(s.base_fare_usd),
          mode: s.mode,
        } as ScheduledService;
      });
      const interline = (await session.run('MATCH (a:Carrier)-[:INTERLINES_WITH]->(b:Carrier) RETURN a.code AS a, b.code AS b')).records.map(
        (r) => [r.get('a'), r.get('b')] as [string, string],
      );
      if (!nodes.length || !services.length) throw new Error('Neo4j graph is empty — run `npm run seed:neo4j`');
      return { data: { nodes, carriers, services, interline }, source: 'neo4j' };
    } finally {
      await session.close();
    }
  } catch (err) {
    log(`Neo4j unavailable (${(err as Error).message}); falling back to seed files`);
    return { data: loadNetworkFromFiles(), source: 'files' };
  } finally {
    await driver.close();
  }
}
