Feature: Storage billing — price contract (ADR-027, Phase 5)
  As the storage-billing pipeline
  I want the per-MiB-hour unit price pinned to the €3/GiB-month headline
  So that the Stripe meter bills the agreed rate and a catalog edit cannot silently drift it

  # The STORAGE_GB meter sums additive hourly MiB values over the period; one static
  # unit_amount_decimal applied to that sum is the bill. Quantities are binary (MiB = bytes/1_048_576,
  # GiB = 1024 MiB); we bill LOGICAL (uncompressed) volume. These scenarios pin the price math so the
  # externally-created Stripe Price can be checked against it and never diverge unnoticed.

  @unit
  Scenario: The headline storage price is €3 per logical GiB-month
    Given the storage pricing contract
    When the headline price is read
    Then it is €3 per GiB-month on the 30-day-month convention

  @unit
  Scenario: The unit price derives from the headline by the documented formula
    Given the €3 per GiB-month headline
    When the per-MiB-hour unit price is derived
    Then it equals the headline divided by 30 days, 24 hours, and 1024 MiB per GiB

  @unit
  Scenario: The Stripe unit_amount_decimal is pinned in cents per MiB-hour
    Given the per-MiB-hour unit price
    When it is expressed as the Stripe unit_amount_decimal
    Then it is the price in cents per MiB-hour, pinned so the catalog cannot drift

  @unit
  Scenario: The unit price round-trips to the €0.10 per GiB-day headline
    Given the per-MiB-hour unit price
    When a full GiB held for a day is priced
    Then the cost is €0.10 per GiB-day

  @unit
  Scenario: The meter is additive and named to match the report command
    Given the STORAGE_GB meter configuration
    When its aggregation and event name are read
    Then it sums the hourly event that the report command sends
