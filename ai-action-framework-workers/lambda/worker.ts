export default class Worker {
  constructor(
    public description: string,
    public key: string,
    public endpoints: { [key: string]: { description: string, input: object, output: object, path: string } }
  ) {}

  getDescription() {
    return this.description;
  }

  getKey() {
    return this.key;
  }

  getEndpoints() {
    return this.endpoints;
  }
}
