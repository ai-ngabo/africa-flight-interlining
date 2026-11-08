/**
 * Seeds the free Neo4j Community Edition graph from data/*.json + services.txt.
 *   docker compose up -d neo4j
 *   NEO4J_URI=bolt://localhost:7687 npm run seed:neo4j
 */
import neo4j from 'neo4j-driver';
import { loadNetworkFromFiles } from '../packages/shared/src/index';

const uri = process.env.NEO4J_URI ?? 'bolt://localhost:7687';
const driver = neo4j.driver(uri, neo4j.auth.basic(process.env.NEO4J_USER ?? 'neo4j', process.env.NEO4J_PASSWORD ?? 'localpassword'));
const { nodes, carriers, services, interline } = loadNetworkFromFiles();
const session = driver.session();

try {
  await session.run('CREATE CONSTRAINT node_code IF NOT EXISTS FOR (n:TransitNode) REQUIRE n.code IS UNIQUE');
  await session.run('CREATE CONSTRAINT carrier_code IF NOT EXISTS FOR (c:Carrier) REQUIRE c.code IS UNIQUE');
  await session.run('MATCH (n) DETACH DELETE n');

  await session.run(
    `UNWIND $nodes AS n
     MERGE (t:TransitNode {code: n.code}) SET t += n`,
    { nodes },
  );
  await session.run(`MATCH (t:TransitNode) WHERE t.type = 'airport' SET t:Airport`);
  await session.run(`MATCH (t:TransitNode) WHERE t.type = 'bus_terminal' SET t:BusTerminal`);
  await session.run(
    `UNWIND $carriers AS c MERGE (x:Carrier {code: c.code}) SET x += c`,
    { carriers },
  );
  await session.run(
    `UNWIND $pairs AS p MATCH (a:Carrier {code: p[0]}), (b:Carrier {code: p[1]})
     MERGE (a)-[:INTERLINES_WITH]->(b) MERGE (b)-[:INTERLINES_WITH]->(a)`,
    { pairs: interline },
  );
  await session.run(
    `UNWIND $services AS s
     MATCH (a:TransitNode {code: s.from}), (b:TransitNode {code: s.to})
     CREATE (a)-[:SERVICE {
       carrier_id: s.carrier, flight_number: s.number, mode: s.mode, dep_local: s.dep,
       duration_minutes: s.durationMin, days: s.days, operational_frequency: size(s.days),
       base_fare_usd: s.fareUsd
     }]->(b)`,
    { services },
  );
  // Metro links let Cypher users explore ground transfers (airport <-> coach terminal).
  await session.run(
    `MATCH (a:TransitNode), (b:TransitNode) WHERE a.metro = b.metro AND a.code < b.code
     MERGE (a)-[:SAME_METRO {transfer_minutes: a.accessMin + b.accessMin}]-(b)`,
  );
  const r = await session.run('MATCH ()-[s:SERVICE]->() RETURN count(s) AS c');
  console.log(`Seeded ${nodes.length} nodes, ${carriers.length} carriers, ${r.records[0].get('c')} services into ${uri}`);
} finally {
  await session.close();
  await driver.close();
}
