// The host validates the input/output schemas. No permission or persistence is needed.
export async function greet(input, _context) {
  return { message: `Hello, ${input.name}!` }
}
