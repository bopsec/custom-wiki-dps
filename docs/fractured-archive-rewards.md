# Fractured Archive data and mechanics

The Fractured Archive equipment and NPC records come from the OSRS Wiki DPS calculator's
generated `cdn/json/equipment.json` and `cdn/json/monsters.json`. The temporary reward
items and `Frac` NPCs have been removed. This fork also incorporates the Wiki calculator's
Fractured Archive combat implementation, including Bork's Smork HP phase selector,
Obligator's two Thrust styles, Ascension crossbow ammunition, spell fragment toggles, and
the released NPC Defence floors. The Wiki's NPC stats supersede our provisional values.

Older saved loadouts with temporary reward IDs map to the released items. Older saved
selections for Archive Guardian, Dagon'hai Monk, and Ocellus phase 1 map to the Wiki IDs.

The Wiki implementation currently flags Rondache's special attack and Zorya's tome's
follow-up special attacks as unsupported. Its single-target model also does not represent
Obligator hitting separate NPCs in a line.
