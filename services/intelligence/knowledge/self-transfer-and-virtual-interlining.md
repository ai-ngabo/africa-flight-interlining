# Self-transfer (virtual interlining) – passenger guidance

> Seed knowledge for the MVP's policy agent.

## What a self-transfer is
A virtual interline itinerary combines separate tickets on airlines (or coach operators) that have
no interline or codeshare agreement. Because the tickets are separate:

1. **Bags are not checked through.** The passenger must collect checked baggage at the connecting
   airport and check in again with the next carrier.
2. **The passenger usually must pass immigration** at the connecting airport to reach the landside
   check-in hall. This means the passenger needs **entry permission (visa / visa-free status) for the
   connecting country**, not just a transit visa.
3. **The airlines do not protect the connection.** If the first flight is late, the second airline
   treats the passenger as a no-show.

## Minimum connection times
- A *protected* connection (same ticket / interline) only needs the airport's minimum connection
  time (MCT), typically 45–90 minutes in African hubs.
- A *self-transfer* needs time for disembarkation, immigration, baggage reclaim, landside transfer,
  check-in closing (often 60 minutes before international departures) and security. The platform
  uses 110–210 minutes depending on the airport. Lagos (LOS) and Cairo (CAI) are the most complex.

## Ground transfers
Some itineraries connect an airport and a coach terminal in the same metro area (e.g. Kigali
airport → Nyabugogo terminal). The platform adds road transfer time plus a 30-minute coach boarding
buffer. Land borders always require immigration processing and the relevant entry permission.

## Baggage on self-transfers
Each carrier applies its own allowance. When the allowance on a later leg is lower than an earlier
one, the passenger pays excess baggage at check-in. The platform warns when allowances differ.

## Platform protection (Guaranteed Protection Wrapper)
If protection is purchased and a delay on an earlier leg causes a missed self-transfer, the platform
(acting as master merchant) rebooks the passenger on the next available service to the final
destination at no extra cost and pays for accommodation when the wait is overnight (more than 6
hours, or crossing 00:00 local). Protection does not cover missed connections caused by the
passenger arriving late or lacking travel documents.
