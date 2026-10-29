package demo;

import org.junit.jupiter.api.Test;

class DeadlockTest {
  static final Object A = new Object(), B = new Object();

  @Test
  void hangs() throws Exception {
    Thread t1 = new Thread(() -> { synchronized (A) { sleep(); synchronized (B) { } } }, "worker-A");
    Thread t2 = new Thread(() -> { synchronized (B) { sleep(); synchronized (A) { } } }, "worker-B");
    t1.start(); t2.start();
    t1.join();
  }

  static void sleep() { try { Thread.sleep(500); } catch (InterruptedException e) { } }
}
