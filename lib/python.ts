import {
  FieldDefinitionNode,
  GraphQLSchema,
  Kind,
  NamedTypeNode,
  NonNullTypeNode,
  ObjectTypeDefinitionNode,
  UnionTypeDefinitionNode,
} from "graphql";

const indent = " ".repeat(4);

const pythonBuiltinTypes = {
  Int: "int",
  Float: "float",
  String: "str",
  Boolean: "bool",
  ID: "str",
};

enum ExtraKind {
  OPTIONAL_TYPE = "ExtraNodeOptionalType",
}

type Imports = Record<string, Set<string>>;
function mergeImports(
  imports: Imports,
  newImports: Record<string, Set<string> | string[]>
): Imports {
  for (const module in newImports) {
    for (const item of newImports[module]) {
      if (!imports[module]) {
        imports[module] = new Set();
      }

      imports[module].add(item);
    }
  }

  return imports;
}

const noopHandler = (..._args: any) => [null, {}]

const nodeHandlers = {
  [ExtraKind.OPTIONAL_TYPE]: function handleOptionalTypeNode(
    node,
    config: FromSchemaConfig
  ) {
    const [code, imports] = toPython(node.type, config);

    return [
      `Optional[${code}]`,
      mergeImports(imports, { typing: ["Optional"] }),
    ];
  },
  [Kind.SCALAR_TYPE_DEFINITION]: noopHandler,
  [Kind.NON_NULL_TYPE]: function handleNonNullTypeNode(
    node: NonNullTypeNode,
    config: FromSchemaConfig
  ) {
    return toPython(node.type, config);
  },
  [Kind.LIST_TYPE]: function handleNonNullTypeNode(
    node: NonNullTypeNode,
    config: FromSchemaConfig
  ) {
    const [code, imports] = toPython(node.type, config);

    return [`List[${code}]`, mergeImports(imports, { typing: ["List"] })];
  },
  [Kind.NAMED_TYPE]: function handleNamedTypeNode(
    node: NamedTypeNode,
    config: FromSchemaConfig
  ) {
    const typeMap = { ...pythonBuiltinTypes, ...config.extraTypes };

    return [typeMap[node.name.value] || `"${node.name.value}"`, {}];
  },
  [Kind.FIELD_DEFINITION]: function handleFieldDefinitionNode(
    node: FieldDefinitionNode,
    config: FromSchemaConfig
  ) {
    const [code, imports] = toPython(node.type, config);

    return [`${node.name.value}: ${code || "None"}`, imports];
  },
  [Kind.UNION_TYPE_DEFINITION]: function handleUnionTypeDefinitionNode(
    node: UnionTypeDefinitionNode,
    config: FromSchemaConfig
  ) {
    let [types, imports] = listToPython(node.types, config);

    return [
      `${node.name.value} = Union[${types.join(", ")}]`,
      mergeImports(imports, { typing: ["Union"] }),
    ];
  },
  [Kind.OBJECT_TYPE_DEFINITION]: function handleObjectTypeDefinitionNode(
    node: ObjectTypeDefinitionNode,
    config: FromSchemaConfig
  ) {
    let [fields, imports] = listToPython(node.fields, config);
    let parentType = "";

    if (config.super) {
      parentType = `(${config.super})`;
    }

    return [
      `class ${node.name.value}${parentType}:
${indent}${fields.length ? fields.join(`\n${indent}`) : "pass"}`,
      imports,
    ];
  },
};

function patchNode(node) {
  if (node.astNode) {
    node = node.astNode;
  }

  if ([Kind.FIELD_DEFINITION, Kind.LIST_TYPE].includes(node.kind)) {
    if (node.type.kind !== Kind.NON_NULL_TYPE) {
      return {
        ...node,
        type: {
          kind: ExtraKind.OPTIONAL_TYPE,
          type: node.type,
        },
      };
    }
  }

  return node;
}

function listToPython(nodeList, config: FromSchemaConfig): [string[], Imports] {
  const items = [];
  let imports = {};

  if (config.extraImports) {
    imports = mergeImports(imports, config.extraImports);
  }

  for (const node of nodeList || []) {
    const [code, currentImports] = toPython(node, config);

    if (!code) {
      continue;
    }

    imports = mergeImports(imports, currentImports);
    items.push(code);
  }

  return [items, imports];
}

const toPython = (node, config: FromSchemaConfig): [string | null, Imports] => {
  node = patchNode(node);

  if (!node.kind) {
    return [null, {}];
  }

  const handler = nodeHandlers[node.kind];

  if (!handler) {
    console.warn(`Could not find handler for ${node.kind}`);

    return [null, {}];
  }

  return handler(node, config);
};

interface FromSchemaConfig {
  super?: string;
  extraImports?: Record<string, string[]>;
  extraTypes?: Record<string, string>;
}

export function fromSchema(
  schema: GraphQLSchema,
  config: FromSchemaConfig = {}
): string {
  const typeMap = schema.getTypeMap();
  const [items, imports] = listToPython(Object.values(typeMap), config);

  const importStatements = Object.entries(imports)
    .map(
      ([module, items]) =>
        `from ${module} import ${Array.from(items).sort().join(", ")}`
    )
    .join("\n");

  return [importStatements, ...items].filter(Boolean).join("\n\n");
}
