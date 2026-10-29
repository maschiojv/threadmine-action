package demo;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class PlainFailureTest {
  @Test
  void fails() {
    assertEquals(1, 2);
  }
}
