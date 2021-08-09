const w = require("ws");
const { createServer } = require("http");
const express = require("express");
const { execute, subscribe } = require("graphql");
const { ApolloServer, gql } = require("apollo-server-express");
const { PubSub } = require("graphql-subscriptions");
const { SubscriptionServer } = require("subscriptions-transport-ws");
const { makeExecutableSchema } = require("@graphql-tools/schema");

(async () => {
  let tally = [];

  const PORT = 4000;
  const pubsub = new PubSub();
  const app = express();
  const httpServer = createServer(app);

  // Schema definition
  const typeDefs = gql`
    type Query {
      tally: [Tally!]!
    }

    type Subscription {
      tallyUpdated: [Tally!]!
    }

    type Tally {
      country: String!
      gold: Int!
      silver: Int!
      bronze: Int!
    }
  `;

  // Resolver map
  const resolvers = {
    Query: {
      tally() {
        return tally;
      },
    },
    Subscription: {
      tallyUpdated: {
        subscribe: () => pubsub.asyncIterator(["TALLY_UPDATED"]),
      },
    },
  };

  const schema = makeExecutableSchema({ typeDefs, resolvers });

  const server = new ApolloServer({
    schema,
  });
  await server.start();
  server.applyMiddleware({ app });

  SubscriptionServer.create(
    { schema, execute, subscribe },
    { server: httpServer, path: server.graphqlPath }
  );

  httpServer.listen(PORT, () => {
    console.log(
      `🚀 Query endpoint ready at http://localhost:${PORT}${server.graphqlPath}`
    );
    console.log(
      `🚀 Subscription endpoint ready at ws://localhost:${PORT}${server.graphqlPath}`
    );
  });

  const ws = new w.Server({ port: 8080 });

  console.log('🚀 Regular WS endpoint ready at http://localhost:8080')

  const medalWeights = {
    gold: 3,
    silver: 2,
    bronze: 1,
  };

  const getCountryScore = (country) => {
    return (
      country.gold * medalWeights.gold +
      country.silver * medalWeights.silver +
      country.bronze * medalWeights.bronze
    );
  };

  const sortTally = (aTally) => {
    return aTally.sort((a, b) => getCountryScore(b) - getCountryScore(a));
  };

  ws.on("connection", (wss) => {
    wss.on("open", function open() {
      wss.send([]);
    });

    wss.on("message", function incoming(message) {
      message = JSON.parse(message);
      const countryIndex = tally.findIndex(
        ({ country }) => country === message.country
      );

      if (countryIndex === -1) {
        tally = [
          ...tally,
          {
            country: message.country,
            gold: message.medal === "gold" ? 1 : 0,
            silver: message.medal === "silver" ? 1 : 0,
            bronze: message.medal === "bronze" ? 1 : 0,
          },
        ];

        wss.send(JSON.stringify(sortTally(tally)));
        pubsub.publish('TALLY_UPDATED', { tallyUpdated: tally })

        return;
      }

      tally = [
        ...tally.slice(0, countryIndex),
        {
          ...tally[countryIndex],
          [message.medal]: tally[countryIndex][message.medal] + 1,
        },
        ...tally.slice(countryIndex + 1),
      ];

      wss.send(JSON.stringify(sortTally(tally)));
      pubsub.publish('TALLY_UPDATED', { tallyUpdated: tally })

      return;
    });
  });
})();
