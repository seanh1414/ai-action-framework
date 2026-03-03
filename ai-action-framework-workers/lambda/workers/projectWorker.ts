import Worker from '../worker';
// todo the fields won't always be straight forward, especially in a real world scenario so we should also have a dictionary that
// defines the fields and their types so that we can validate the inputs and outputs and use the descriptive names in the code for LLM.
const projects = [
  {
    projectId: '1',
    projectName: 'Phoenix Suns Arena',
    projectLocation: 'Phoenix, AZ',
    projectManager: 'John Doe'
  },
  {
    projectId: '2',
    projectName: 'Seattle Seahawks Arena',
    projectLocation: 'Seattle, WA',
    projectManager: 'John Smith'
  },
  {
    projectId: '3',
    projectName: 'Los Angeles Lakers Training Facility',
    projectLocation: 'Los Angeles, CA',
    projectManager: 'Bill Johnson'
  }
];


class ProjectWorker extends Worker {
  // todo the path probably shouldn not be in code since it comes from the deploy, this could change.
  constructor() {
    super(
      "Manages project information and details.",
      "PROJECT",
      {
        NAMES: {
          description: "Get project names and IDs by search term",
          input: { searchTerm: "text" },
          output: { projects: [{ projectId: "text", projectName: "text" }] },
          path: `${process.env.WORKERS_API_URL || 'https://<your-api-gateway-endpoint>'}/prod/project`
        },
        DETAILS: {
          description: "Get project details by project ID",
          input: { projectId: "text" },
          output: { projectDetails: { projectId: "text", projectName: "text", projectLocation: "text", projectManager: "text" } },
          path: `${process.env.WORKERS_API_URL || 'https://<your-api-gateway-endpoint>'}/prod/project`
        },
        MANAGER: {
          description: "Get projects managed by a specific manager",
          input: { manager: "text" },
          output: { projects: [{ projectId: "text", projectName: "text" }] },
          path: `${process.env.WORKERS_API_URL || 'https://<your-api-gateway-endpoint>'}/prod/project`
        }
      }
    );
  }
  async execute(endpointKey: string, inputs: any) {
      if (endpointKey === "NAMES") {
          const searchTerm = inputs.searchTerm.toLowerCase();
          const filteredProjects = projects
              .filter(project => project.projectName.toLowerCase().includes(searchTerm))
              .map(project => ({ projectId: project.projectId, projectName: project.projectName }));
          return { projects: JSON.stringify(filteredProjects) };
      }

      if (endpointKey === "DETAILS") {
          const projectId = inputs.projectId;
          const project = projects.find(project => project.projectId === projectId);
          if (project) {
              return { projectDetails: JSON.stringify(project) };
          } else {
              return { projectDetails: JSON.stringify(null) };
          }
      }

      if (endpointKey === "MANAGER") {
          const manager = inputs.manager.toLowerCase();
          const managedProjects = projects
              .filter(project => project.projectManager.toLowerCase().includes(manager))
              .map(project => ({ projectId: project.projectId, projectName: project.projectName, projectManager: project.projectManager}));
          return { projects: JSON.stringify(managedProjects) };
      }

      // Ensure a value is always returned
      return {};
  }
}

// Lambda handler to invoke the worker
export const execute = async (event: any) => {
  const body = JSON.parse(event.body);
  const { endpointKey, inputs } = body;

  const worker = new ProjectWorker();
  const result = await worker.execute(endpointKey, inputs);

  return {
    statusCode: 200,
    body: JSON.stringify(result),
  };
};

export default ProjectWorker;
