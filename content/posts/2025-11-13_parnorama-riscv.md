---
  title: "Parnorama‑RISCV: is this possible?"
  date: 2021-08-25
  author: "tinywifi"
---

  > Could the Minecraft panorama shader hide a full RISC‑V stack??? I wasn’t sure either—now it’s panorama with
  panoramics per second.

  ## Quick Specs

  - RV32IMA + Zicsr + Zifencei running entirely inside a fragment shader (machine + supervisor modes intact).
  - 64 MiB RAM tucked into a 2048×2048 RGBA32UI ping-pong texture; the top-left 128×128 tile mirrors registers/CSRs.
  - 16550A UART overlay, keyboard input, and CLINT timer/software IRQs—all glued together in shader space.
  - Fragment loop knocks out 100+ instructions every frame, hitting ~200 kHz on a 2080 Ti (Java fallback still manages
  ~15 kHz).
  - Drop your own RV32 payload with one call:

  {{< code language="java" title="Loading a payload" open="true" >}}
  RiscVManager mgr = RiscVManager.getInstance();
  mgr.loadProgram(myPayload, 0x80000000);
  mgr.start();
  {{< /code >}}

  ## How the Shader Keeps Its Chill

  - Every frame, the fragment shader pulls CPU state from that 128×128 tile, runs a batch of ticks, and writes the
  refreshed state back into the swap texture—no CPU handholding required.
  - RAM writes pile up in a tiny register-resident cache; the commit pass flushes everything to the big texture so the
  next frame sees a coherent memory image.
  - Instruction decode leans on table-driven [forcecase] jump tables so DXC doesn’t implode, and even the unaligned
  loads loop politely instead of exploding into inlined confetti.
  - If the GPU taps out, the Java fallback resumes straight from the texture snapshot—zero drama, just a quick baton
  pass.

  ## Prime Time Demo (pun required)

  Below is the exact toolchain I’m using for the “primes up to 10 000” benchmark that now runs as a built-in program
  (`load prime` → `run`).

  ### 1. Reference C (tools/payloads/prime_timer.c)

  {{< code language="c" title="Prime benchmark logic in C" open="true" >}}
  #include <stdint.h>
  #define UART_BASE ((volatile uint32_t *)0x10000000u)

  static void uart_putc(char c) { UART_BASE[0] = (uint32_t)c; }
  static void uart_print(const char *s){ while(*s) uart_putc(*s++); }

  static void uart_print_u32(uint32_t value){
      char buf[16]; uint32_t i = 0;
      if (!value) buf[i++] = '0';
      else while (value) { buf[i++] = (value % 10) + '0'; value /= 10; }
      while (i) uart_putc(buf[--i]);
      uart_putc('\n');
  }

  static int is_prime(uint32_t n){
      if (n < 2) return 0;
      for (uint32_t d = 2; d * d <= n; ++d)
          if (n % d == 0) return 0;
      return 1;
  }

  int main(void){
      const uint32_t limit = 10000;
      uint32_t count = 0;
      uart_print("Prime benchmark up to 10000\n");
      uint64_t start = __builtin_readcyclecounter();

      for (uint32_t n = 2; n <= limit; ++n)
          if (is_prime(n)) { uart_print_u32(n); ++count; }

      uint64_t end = __builtin_readcyclecounter();
      uart_print("Total primes: ");
      uart_print_u32(count);
      uart_print("Elapsed cycles: ");
      uart_print_u32((uint32_t)(end - start));
      for(;;);
  }
  {{< /code >}}

  ### 2. RV32 Assembly Block (between `RV32-BEGIN/END`)

  {{< code language="asm" title="Assembler payload consumed by PrimePayloadBuilder" open="true" >}}
  RV32-BEGIN
  .section .text
  .globl _start

  _start:
      lui     sp, 0x80400
      addi    sp, sp, -16

      lui     s3, 0x10000
      la      s0, digit_buffer
      lui     s4, 0x00002
      addi    s4, s4, 0x710       # limit = 10000
      addi    s5, zero, 0         # prime counter

      la      a0, header_str
      jal     ra, print_string

      csrr    s1, cycle
      addi    t2, zero, 2         # candidate

  outer_loop:
      addi    t3, zero, 2         # divisor

  inner_loop:
      mul     t4, t3, t3
      blt     t2, t4, is_prime
      remu    t5, t2, t3
      beq     t5, zero, advance
      addi    t3, t3, 1
      jal     zero, inner_loop

  is_prime:
      mv      a0, t2
      jal     ra, print_number
      addi    s5, s5, 1

  advance:
      addi    t2, t2, 1
      blt     s4, t2, finish
      jal     zero, outer_loop

  finish:
      csrr    s2, cycle
      sub     s2, s2, s1
      la      a0, primes_str
      jal     ra, print_string
      mv      a0, s5
      jal     ra, print_number
      la      a0, cycles_str
      jal     ra, print_string
      mv      a0, s2
      jal     ra, print_number

  done:
      jal     zero, done

  print_string:
      addi    sp, sp, -16
      sw      ra, 12(sp)
  ps_loop:
      lbu     t0, 0(a0)
      beq     t0, zero, ps_done
      sb      t0, 0(s3)
      addi    a0, a0, 1
      jal     zero, ps_loop
  ps_done:
      lw      ra, 12(sp)
      addi    sp, sp, 16
      jalr    zero, ra, 0

  print_number:
      addi    sp, sp, -40
      sw      ra, 36(sp)
      sw      t2, 32(sp)
      mv      t1, a0
      mv      t2, s0
      addi    t3, zero, 0
      addi    t6, zero, 10
      bnez    t1, pn_loop
      addi    t5, zero, 48
      sb      t5, 0(t2)
      addi    t2, t2, 1
      addi    t3, t3, 1
      jal     zero, pn_print
  pn_loop:
      divu    t4, t1, t6
      remu    t5, t1, t6
      addi    t5, t5, 48
      sb      t5, 0(t2)
      addi    t2, t2, 1
      addi    t3, t3, 1
      mv      t1, t4
      bnez    t4, pn_loop
  pn_print:
      addi    t2, t2, -1
      lbu     t5, 0(t2)
      sb      t5, 0(s3)
      addi    t3, t3, -1
      bnez    t3, pn_print
      addi    t5, zero, 10
      sb      t5, 0(s3)
      lw      t2, 32(sp)
      lw      ra, 36(sp)
      addi    sp, sp, 40
      jalr    zero, ra, 0

  digit_buffer:
      .space 32

  header_str:
      .asciz "Prime benchmark up to 10000\n"

  primes_str:
      .asciz "Total primes: "

  cycles_str:
      .asciz "Elapsed cycles: "
  RV32-END
  {{< /code >}}

  ### 3. Java Byte Array (drop into `createPrimeBenchmark()`)

  {{< code language="java" title="Generated payload bytes" open="true" >}}
  return new byte[]{
      (byte)0x37, (byte)0x01, (byte)0x40, (byte)0x80, (byte)0x13, (byte)0x01, (byte)0x01, (byte)0xFF,
      (byte)0xB7, (byte)0x09, (byte)0x00, (byte)0x10, (byte)0x37, (byte)0x04, (byte)0x00, (byte)0x80,
      (byte)0x13, (byte)0x04, (byte)0x44, (byte)0x14, (byte)0x37, (byte)0x2A, (byte)0x00, (byte)0x00,
      (byte)0x13, (byte)0x0A, (byte)0x0A, (byte)0x71, (byte)0x93, (byte)0x0A, (byte)0x00, (byte)0x00,
      (byte)0x37, (byte)0x05, (byte)0x00, (byte)0x80, (byte)0x13, (byte)0x05, (byte)0x45, (byte)0x16,
      (byte)0xEF, (byte)0x00, (byte)0x40, (byte)0x07, (byte)0xF3, (byte)0x24, (byte)0x00, (byte)0xC0,
      (byte)0x93, (byte)0x03, (byte)0x20, (byte)0x00, (byte)0x13, (byte)0x0E, (byte)0x20, (byte)0x00,
      (byte)0xB3, (byte)0x0E, (byte)0xCE, (byte)0x03, (byte)0x63, (byte)0xCA, (byte)0xD3, (byte)0x01,
      (byte)0x33, (byte)0xFF, (byte)0xC3, (byte)0x03, (byte)0x63, (byte)0x0C, (byte)0x0F, (byte)0x00,
      (byte)0x13, (byte)0x0E, (byte)0x1E, (byte)0x00, (byte)0x6F, (byte)0xF0, (byte)0xDF, (byte)0xFE,
      (byte)0x13, (byte)0x85, (byte)0x03, (byte)0x00, (byte)0xEF, (byte)0x00, (byte)0x00, (byte)0x07,
      (byte)0x93, (byte)0x8A, (byte)0x1A, (byte)0x00, (byte)0x93, (byte)0x83, (byte)0x13, (byte)0x00,
      (byte)0x63, (byte)0x44, (byte)0x7A, (byte)0x00, (byte)0x6F, (byte)0xF0, (byte)0x1F, (byte)0xFD,
      (byte)0x73, (byte)0x29, (byte)0x00, (byte)0xC0, (byte)0x33, (byte)0x09, (byte)0x99, (byte)0x40,
      (byte)0x37, (byte)0x05, (byte)0x00, (byte)0x80, (byte)0x13, (byte)0x05, (byte)0x15, (byte)0x18,
      (byte)0xEF, (byte)0x00, (byte)0x40, (byte)0x02, (byte)0x13, (byte)0x85, (byte)0x0A, (byte)0x00,
      (byte)0xEF, (byte)0x00, (byte)0x40, (byte)0x04, (byte)0x37, (byte)0x05, (byte)0x00, (byte)0x80,
      (byte)0x13, (byte)0x05, (byte)0x05, (byte)0x19, (byte)0xEF, (byte)0x00, (byte)0x00, (byte)0x01,
      (byte)0x13, (byte)0x05, (byte)0x09, (byte)0x00, (byte)0xEF, (byte)0x00, (byte)0x00, (byte)0x03,
      (byte)0x6F, (byte)0x00, (byte)0x00, (byte)0x00, (byte)0x13, (byte)0x01, (byte)0x01, (byte)0xFF,
      (byte)0x23, (byte)0x26, (byte)0x11, (byte)0x00, (byte)0x83, (byte)0x42, (byte)0x05, (byte)0x00,
      (byte)0x63, (byte)0x88, (byte)0x02, (byte)0x00, (byte)0x23, (byte)0x80, (byte)0x59, (byte)0x00,
      (byte)0x13, (byte)0x05, (byte)0x15, (byte)0x00, (byte)0x6F, (byte)0xF0, (byte)0x1F, (byte)0xFF,
      (byte)0x83, (byte)0x20, (byte)0xC1, (byte)0x00, (byte)0x13, (byte)0x01, (byte)0x01, (byte)0x01,
      (byte)0x67, (byte)0x80, (byte)0x00, (byte)0x00, (byte)0x13, (byte)0x01, (byte)0x81, (byte)0xFD,
      (byte)0x23, (byte)0x22, (byte)0x11, (byte)0x02, (byte)0x23, (byte)0x20, (byte)0x71, (byte)0x02,
      (byte)0x13, (byte)0x03, (byte)0x05, (byte)0x00, (byte)0x93, (byte)0x03, (byte)0x04, (byte)0x00,
      (byte)0x13, (byte)0x0E, (byte)0x00, (byte)0x00, (byte)0x93, (byte)0x0F, (byte)0xA0, (byte)0x00,
      (byte)0x63, (byte)0x1C, (byte)0x03, (byte)0x00, (byte)0x13, (byte)0x0F, (byte)0x00, (byte)0x03,
      (byte)0x23, (byte)0x80, (byte)0xE3, (byte)0x01, (byte)0x93, (byte)0x83, (byte)0x13, (byte)0x00,
      (byte)0x13, (byte)0x0E, (byte)0x1E, (byte)0x00, (byte)0x6F, (byte)0x00, (byte)0x40, (byte)0x02,
      (byte)0xB3, (byte)0x5E, (byte)0xF3, (byte)0x03, (byte)0x33, (byte)0x7F, (byte)0xF3, (byte)0x03,
      (byte)0x13, (byte)0x0F, (byte)0x0F, (byte)0x03, (byte)0x23, (byte)0x80, (byte)0xE3, (byte)0x01,
      (byte)0x93, (byte)0x83, (byte)0x13, (byte)0x00, (byte)0x13, (byte)0x0E, (byte)0x1E, (byte)0x00,
      (byte)0x13, (byte)0x83, (byte)0x0E, (byte)0x00, (byte)0xE3, (byte)0x92, (byte)0x0E, (byte)0xFE,
      (byte)0x93, (byte)0x83, (byte)0xF3, (byte)0xFF, (byte)0x03, (byte)0xCF, (byte)0x03, (byte)0x00,
      (byte)0x23, (byte)0x80, (byte)0xE9, (byte)0x01, (byte)0x13, (byte)0x0E, (byte)0xFE, (byte)0xFF,
      (byte)0xE3, (byte)0x18, (byte)0x0E, (byte)0xFE, (byte)0x13, (byte)0x0F, (byte)0xA0, (byte)0x00,
      (byte)0x23, (byte)0x80, (byte)0xE9, (byte)0x01, (byte)0x83, (byte)0x23, (byte)0x01, (byte)0x02,
      (byte)0x83, (byte)0x20, (byte)0x41, (byte)0x02, (byte)0x13, (byte)0x01, (byte)0x81, (byte)0x02,
      (byte)0x67, (byte)0x80, (byte)0x00, (byte)0x00, (byte)0x00, (byte)0x00, (byte)0x00, (byte)0x00,
      (byte)0x50, (byte)0x72, (byte)0x69, (byte)0x6D, (byte)0x65, (byte)0x20, (byte)0x62, (byte)0x65,
      (byte)0x6E, (byte)0x63, (byte)0x68, (byte)0x6D, (byte)0x61, (byte)0x72, (byte)0x6B, (byte)0x20,
      (byte)0x75, (byte)0x70, (byte)0x20, (byte)0x74, (byte)0x6F, (byte)0x20, (byte)0x31, (byte)0x30,
      (byte)0x30, (byte)0x30, (byte)0x30, (byte)0x0A, (byte)0x00, (byte)0x54, (byte)0x6F, (byte)0x74,
      (byte)0x61, (byte)0x6C, (byte)0x20, (byte)0x70, (byte)0x72, (byte)0x69, (byte)0x6D, (byte)0x65,
      (byte)0x73, (byte)0x3A, (byte)0x20, (byte)0x00, (byte)0x45, (byte)0x6C, (byte)0x61, (byte)0x70,
      (byte)0x73, (byte)0x65, (byte)0x64, (byte)0x20, (byte)0x63, (byte)0x79, (byte)0x63, (byte)0x6C,
      (byte)0x65, (byte)0x73, (byte)0x3A, (byte)0x20, (byte)0x00
  };
  {{< /code >}}

  ![parnorama-riscv_showcase]({{ "/img/2025-11-13_parnorama-riscv_showcase.png" | relURL }})
